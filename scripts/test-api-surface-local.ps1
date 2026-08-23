#Requires -Version 5.1
param(
    [string]$PocketBasePath = 'C:\tmp\pocketbase-v0.22.21\pocketbase.exe',
    [switch]$Offline
)

# API surface probe: starts an isolated PocketBase with the real pb_hooks +
# pb_migrations and exercises every custom route plus representative native
# REST rules. Only safe requests are sent: health/reads for public endpoints,
# invalid payloads for public writes, and anonymous negative probes for all
# admin-gated and HMAC-signed internal routes. No real email is sent (gateway
# URL points at the isolated instance itself) and no ESA purge can succeed.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$repoRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $env:TEMP ('blog-api-surface-' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $runRoot 'pb_data'
$hooksRoot = Join-Path $runRoot 'pb_hooks'
$migrationsRoot = Join-Path $runRoot 'pb_migrations'
$process = $null
$bootstrap = $null
$client = $null
$results = [System.Collections.Generic.List[object]]::new()
$failures = [System.Collections.Generic.List[string]]::new()

$environmentNames = @(
    'MAIL_HASH_SECRET', 'MAIL_INTERNAL_SECRET', 'MAIL_GATEWAY_ENABLED',
    'MAIL_ACCOUNT_ENABLED', 'MAIL_OTP_ENABLED', 'MAIL_GATEWAY_INTERNAL_URL',
    'BLOG_AUTH_LOOPBACK_BASE', 'PUBLIC_SITE_URL',
    'ADMIN_AUTH_HASH_SECRET', 'ADMIN_AUTH_INTERNAL_SECRET', 'ADMIN_AUTH_INTERNAL_URL', 'ADMIN_IP',
    'MAIL_ARCHIVE_API_ENABLED', 'MAIL_ARCHIVE_HMAC_SECRET'
)
$previousEnvironment = @{}

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-FreeTcpPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Read-SharedText {
    # Log files redirected by Start-Process are still locked by the PocketBase
    # process, so read them with FileShare.ReadWrite. Get-Content/ReadAllText
    # open with FileShare.Read and fail, leaving timeout errors blank.
    param([Parameter(Mandatory)][string]$Path)
    try {
        $fs = [IO.FileStream]::new($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        try {
            $reader = [IO.StreamReader]::new($fs)
            try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
        } finally { $fs.Dispose() }
    } catch { return "(unreadable: $($_.Exception.Message))" }
}

function Assert-SafeRunRoot {
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    $resolved = [IO.Path]::GetFullPath($runRoot)
    if (-not $resolved.StartsWith($tempRoot + '\blog-api-surface-', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe run root: $resolved"
    }
    return $resolved
}

function Invoke-Probe {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        $Body = $null
    )
    $url = "http://127.0.0.1:$script:port" + $Path
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $url)
    try {
        [void]$message.Headers.TryAddWithoutValidation('User-Agent', 'api-surface-probe/1.0')
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 10 -Compress
            $message.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        }
        $response = $client.SendAsync($message).GetAwaiter().GetResult()
        try {
            $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            return [pscustomobject]@{ Label = $Label; Method = $Method; Path = $Path; Status = [int]$response.StatusCode; Raw = $raw }
        } finally { $response.Dispose() }
    } finally { $message.Dispose() }
}

function Record-Result {
    param([Parameter(Mandatory)]$Probe, [Parameter(Mandatory)][bool]$Ok, [Parameter(Mandatory)][string]$Expect)
    $results.Add([pscustomobject]@{ Label = $Probe.Label; Method = $Probe.Method; Path = $Probe.Path; Status = $Probe.Status; Ok = $Ok; Expect = $Expect })
    if (-not $Ok) { $failures.Add("$($Probe.Label): $($Probe.Method) $($Probe.Path) -> $($Probe.Status), expected $Expect") }
}

function Expect-Status {
    param([Parameter(Mandatory)]$Probe, [Parameter(Mandatory)][int]$Expected, [string]$NotContains = '')
    $ok = $Probe.Status -eq $Expected
    if ($ok -and $NotContains) { $ok = $Probe.Raw -notmatch [regex]::Escape($NotContains) }
    Record-Result -Probe $Probe -Ok $ok -Expect ("HTTP $Expected" + $(if ($NotContains) { " without '$NotContains'" } else { '' }))
}

function Expect-StatusIn {
    param([Parameter(Mandatory)]$Probe, [Parameter(Mandatory)][int[]]$Expected, [string]$Contains = '')
    $ok = $Expected -contains $Probe.Status
    if ($ok -and $Contains) { $ok = $Probe.Raw.Contains($Contains) }
    Record-Result -Probe $Probe -Ok $ok -Expect ("HTTP $($Expected -join '/')" + $(if ($Contains) { " with '$Contains'" } else { '' }))
}

[void](Assert-SafeRunRoot)
if (-not (Test-Path -LiteralPath $PocketBasePath -PathType Leaf)) {
    if ($Offline) { throw "PocketBase binary is unavailable in offline mode: $PocketBasePath" }
    throw "PocketBase binary is required locally: $PocketBasePath"
}

New-Item -ItemType Directory -Force -Path $dataRoot, $hooksRoot, $migrationsRoot | Out-Null

foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$port = Get-FreeTcpPort
[Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('MAIL_INTERNAL_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('MAIL_GATEWAY_ENABLED', 'true', 'Process')
[Environment]::SetEnvironmentVariable('MAIL_ACCOUNT_ENABLED', 'true', 'Process')
[Environment]::SetEnvironmentVariable('MAIL_OTP_ENABLED', 'true', 'Process')
[Environment]::SetEnvironmentVariable('MAIL_GATEWAY_INTERNAL_URL', "http://127.0.0.1:$port", 'Process')
[Environment]::SetEnvironmentVariable('BLOG_AUTH_LOOPBACK_BASE', "http://127.0.0.1:$port", 'Process')
[Environment]::SetEnvironmentVariable('PUBLIC_SITE_URL', 'http://localhost:4321', 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_HASH_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_INTERNAL_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_INTERNAL_URL', "http://127.0.0.1:$port", 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_IP', '127.0.0.1', 'Process')
# mail-archive routes check MAIL_ARCHIVE_API_ENABLED before signature
# verification; enable them and set an HMAC secret so unsigned probes exercise
# the real rejection path (401 ARCHIVE_AUTH_REJECTED) instead of 409 DISABLED.
[Environment]::SetEnvironmentVariable('MAIL_ARCHIVE_API_ENABLED', 'true', 'Process')
[Environment]::SetEnvironmentVariable('MAIL_ARCHIVE_HMAC_SECRET', (New-RandomSecret), 'Process')

$stdoutPath = Join-Path $runRoot 'pocketbase.out.log'
$stderrPath = Join-Path $runRoot 'pocketbase.err.log'

try {
    # Bootstrap phase: start PocketBase once with the EMPTY hooks/migrations
    # dirs so it creates the system tables (_collections etc.); the custom
    # migration 001 fails when the system tables are missing.
    $bootstrapPort = Get-FreeTcpPort
    # Guard: an empty port turns --http=127.0.0.1: into a random port and the
    # health check below would hit port 80 and time out.
    if (-not $bootstrapPort) { throw 'Get-FreeTcpPort returned no port for bootstrap' }
    $bootstrapStdout = Join-Path $runRoot 'bootstrap.out.log'
    $bootstrapStderr = Join-Path $runRoot 'bootstrap.err.log'
    $bootstrapArgs = @('serve', "--dir=$dataRoot", "--hooksDir=$hooksRoot", "--migrationsDir=$migrationsRoot", "--http=127.0.0.1:$bootstrapPort", '--dev=false')
    $bootstrap = Start-Process -FilePath $PocketBasePath -ArgumentList $bootstrapArgs -WorkingDirectory $runRoot -WindowStyle Hidden -RedirectStandardOutput $bootstrapStdout -RedirectStandardError $bootstrapStderr -PassThru
    $bootstrapReady = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($bootstrap.HasExited) {
            throw "PocketBase bootstrap exited early: $(Read-SharedText $bootstrapStderr)"
        }
        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$bootstrapPort/api/health" -TimeoutSec 1
            if ($health.StatusCode -eq 200) { $bootstrapReady = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 150
    }
    if (-not $bootstrapReady) {
        $bootstrapLogs = "STDOUT:`n" + (Read-SharedText $bootstrapStdout) + "`nSTDERR:`n" + (Read-SharedText $bootstrapStderr)
        throw "PocketBase bootstrap did not become healthy on port ${bootstrapPort}: $bootstrapLogs"
    }
    Stop-Process -Id $bootstrap.Id -Force
    $bootstrap.WaitForExit(5000) | Out-Null

    Copy-Item -Path (Join-Path $repoRoot 'pb_hooks\*') -Destination $hooksRoot -Recurse -Force
    Copy-Item -Path (Join-Path $repoRoot 'pb_migrations\*') -Destination $migrationsRoot -Recurse -Force

    if (-not $port) { throw 'Get-FreeTcpPort returned no port for the main instance' }
    $arguments = @('serve', "--dir=$dataRoot", "--hooksDir=$hooksRoot", "--migrationsDir=$migrationsRoot", "--http=127.0.0.1:$port", '--dev=false')
    $process = Start-Process -FilePath $PocketBasePath -ArgumentList $arguments -WorkingDirectory $runRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) {
            $details = "STDOUT:`n" + (Read-SharedText $stdoutPath) + "`nSTDERR:`n" + (Read-SharedText $stderrPath)
            throw "PocketBase exited early ($($process.ExitCode)): $details"
        }
        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 1
            if ($health.StatusCode -eq 200) { $ready = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 150
    }
    if (-not $ready) {
        $timeoutLogs = "STDOUT:`n" + (Read-SharedText $stdoutPath) + "`nSTDERR:`n" + (Read-SharedText $stderrPath)
        throw "Timed out waiting for PocketBase on port ${port}: $timeoutLogs"
    }

    $client = [Net.Http.HttpClient]::new()

    # Seed one page view so the stats probes below exercise a non-empty dataset
    # (empty-set NULL handling in stats_lib.js is covered by test-stats-friend-local.ps1).
    Expect-Status (Invoke-Probe 'track view valid (seeds stats)' POST '/api/track-view' @{ path = '/probe' }) 202

    # ---- Public read / health endpoints ----
    Expect-Status (Invoke-Probe 'registration health' GET '/api/blog-auth/registration/health') 200
    Expect-Status (Invoke-Probe 'mail facade health' GET '/api/blog-auth/mail/health') 200
    Expect-Status (Invoke-Probe 'search basic' GET '/api/search?q=probe') 200
    Expect-Status (Invoke-Probe 'search injection stays contained' GET '/api/search?q=%22%20OR%201%3D1%20--') 200
    Expect-Status (Invoke-Probe 'search suggest' GET '/api/search/suggest?q=probe') 200
    Expect-Status (Invoke-Probe 'blog stats public' GET '/api/blog-stats?range=30d') 200 -NotContains 'visitor_hash'
    Expect-Status (Invoke-Probe 'blog stats detail ignored anonymously' GET '/api/blog-stats?range=30d&detail=1') 200 -NotContains '"detail"'
    Expect-Status (Invoke-Probe 'friend link stats' GET '/api/friend-link-stats') 200

    # ---- Public write endpoints (safe payloads only) ----
    Expect-Status (Invoke-Probe 'track view invalid path' POST '/api/track-view' @{ path = 'probe' }) 400
    # comment_actions_lib.js reads path params via e.httpContext.pathParam and
    # bodies via readerToString(e.request().body); the strict contracts below
    # (404 NotFound / 400 'Invalid email format') must hold for all callers.
    Expect-StatusIn (Invoke-Probe 'comment verification rejects bad email' POST '/api/comments/verification/send' @{ email = 'not-an-email' }) @(400) -Contains 'Invalid email format'
    Expect-Status (Invoke-Probe 'comment like on missing comment' POST '/api/comments/missing-comment-id/like' @{}) -Expected 404
    # edit/delete validate required fields before lookup; send full fields so the
    # probe reaches the not-found path (comment_actions_lib.js editComment/deleteComment).
    Expect-Status (Invoke-Probe 'comment edit on missing comment' POST '/api/comments/missing-comment-id/edit' @{ content = 'x'; author_email = 'surface-probe@example.com'; verification_code = '000000' }) -Expected 404
    Expect-Status (Invoke-Probe 'comment delete on missing comment' POST '/api/comments/missing-comment-id/delete' @{ author_email = 'surface-probe@example.com'; verification_code = '000000' }) -Expected 404
    Expect-Status (Invoke-Probe 'otp verify wrong challenge' POST '/api/blog-auth/otp/verify' @{ challengeId = 'missing'; code = '000000' }) 400
    Expect-Status (Invoke-Probe 'register missing fields' POST '/api/blog-auth/register' @{}) 400
    Expect-Status (Invoke-Probe 'password reset uniform accepted' POST '/api/blog-auth/password-reset/request' @{ email = 'surface-probe@example.com' }) 202

    # ---- Admin-gated routes: anonymous must get 401/403, never 404/500 ----
    # security_policy_admin.pb.js and cache_admin.pb.js keep their helpers in
    # pb_hooks/lib (security_policy_route_helpers.js / cache_admin_helpers.js)
    # because the PB 0.22 JSVM request runtime cannot resolve .pb.js IIFE
    # closures; anonymous probes must still hit the 401/403 gate.
    $adminGets = @(
        '/api/blog-admin/step-up/status', '/api/blog-admin/security/status', '/api/blog-admin/security/events',
        '/api/blog-admin/esa/config', '/api/blog-admin/esa/tasks',
        '/api/blog-admin/mail/overview', '/api/blog-admin/mail/queue', '/api/blog-admin/mail/logs',
        '/api/blog-admin/mail/templates', '/api/blog-admin/mail/rules', '/api/blog-admin/mail/suppress', '/api/blog-admin/mail/smtp',
        '/api/blog-admin/security/rate-policy', '/api/blog-admin/security/registration-mode',
        '/api/blog-admin/email-verification-status'
    )
    foreach ($path in $adminGets) { Expect-StatusIn (Invoke-Probe "anon admin gate GET $path" GET $path) @(401, 403) }

    $adminPosts = @(
        '/api/blog-admin/step-up/revoke', '/api/blog-admin/totp/setup', '/api/blog-admin/totp/confirm',
        '/api/blog-admin/totp/verify', '/api/blog-admin/totp/revoke', '/api/blog-admin/local-recovery',
        '/api/blog-admin/esa/purge', '/api/blog-admin/mail/verify', '/api/blog-admin/mail/test'
    )
    foreach ($path in $adminPosts) { Expect-StatusIn (Invoke-Probe "anon admin gate POST $path" POST $path @{}) @(401, 403) }

    $adminPuts = @(
        '/api/blog-admin/esa/config', '/api/blog-admin/mail/smtp', '/api/blog-admin/mail/templates',
        '/api/blog-admin/security/rate-policy', '/api/blog-admin/security/registration-mode'
    )
    foreach ($path in $adminPuts) { Expect-StatusIn (Invoke-Probe "anon admin gate PUT $path" PUT $path @{}) @(401, 403) }

    Expect-Status (Invoke-Probe 'unknown admin route is 404' GET '/api/blog-admin/definitely-missing') 404

    # ---- HMAC-signed internal mail-archive routes: unsigned must be rejected ----
    $archiveRoutes = @('status', 'prepare', 'export', 'seal', 'uploaded', 'commit', 'restore-descriptor', 'retention-due', 'retention-confirm')
    foreach ($route in $archiveRoutes) {
        Expect-StatusIn (Invoke-Probe "unsigned mail-archive $route" POST "/api/blog-internal/mail-archive/$route" @{}) @(401, 403) -Contains 'ARCHIVE_AUTH_REJECTED'
    }

    # ---- Native REST rules spot checks (anonymous) ----
    Expect-Status (Invoke-Probe 'native posts list published only' GET '/api/collections/posts/records') 200
    Expect-StatusIn (Invoke-Probe 'native posts create denied' POST '/api/collections/posts/records' @{ title = 'x' }) @(400, 401, 403)
    # comments.listRule is a staff-only filter (migration 20260627070000), so an
    # anonymous list is 200 filtered down to zero records, never a record leak.
    Expect-StatusIn (Invoke-Probe 'native raw comments list filtered to empty' GET '/api/collections/comments/records') @(200) -Contains '"items":[]'
    Expect-Status (Invoke-Probe 'native public_comments view allowed' GET '/api/collections/public_comments/records') 200
    Expect-StatusIn (Invoke-Probe 'native comment_likes fully private' GET '/api/collections/comment_likes/records') @(401, 403)
    Expect-Status (Invoke-Probe 'native tags list' GET '/api/collections/tags/records') 200
    Expect-Status (Invoke-Probe 'native settings whitelist list' GET '/api/collections/settings/records') 200
    Expect-StatusIn (Invoke-Probe 'native users registration closed' POST '/api/collections/users/records' @{ email = 'surface-probe@example.com'; password = 'surface-probe-password'; passwordConfirm = 'surface-probe-password' }) @(400, 403)
    Expect-Status (Invoke-Probe 'native users bad password login' POST '/api/collections/users/auth-with-password' @{ identity = 'surface-probe@example.com'; password = 'wrong-password' }) 400

    $passed = @($results | Where-Object { $_.Ok }).Count
    $failed = @($results | Where-Object { -not $_.Ok }).Count
    Write-Host "API surface probe: $passed passed, $failed failed, $($results.Count) total"
    $results | Format-Table Label, Method, Path, Status, Ok -AutoSize | Out-String -Width 200 | Write-Host
    if ($failures.Count -ne 0) { throw ($failures -join [Environment]::NewLine) }
    Write-Host 'PASS api surface probe: public endpoints healthy, admin gates deny anonymous, signed internal routes reject unsigned calls, native REST rules enforced'
} finally {
    if ($null -ne $bootstrap -and -not $bootstrap.HasExited) {
        Stop-Process -Id $bootstrap.Id -Force
        $bootstrap.WaitForExit(5000) | Out-Null
    }
    if ($null -ne $client) { $client.Dispose() }
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit(5000) | Out-Null
    }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    if (Test-Path -LiteralPath $runRoot) { Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
