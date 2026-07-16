#Requires -Version 5.1
param(
    [string]$PocketBasePath = (Join-Path $env:TEMP 'pb-0.22.21-track-a\pocketbase.exe'),
    [int]$Port = 18091,
    [int]$StubPort = 18092
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$repoRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $env:TEMP 'blog-admin-step-up-e2e'
$fixturePath = Join-Path $repoRoot 'tests\admin-security\step_up_fixture.pb.js'
$legacySeedFixture = Join-Path $repoRoot 'tests\admin-security\legacy_session_seed.pb.js'
$stubPath = Join-Path $repoRoot 'tests\admin-security\webauthn_stub.mjs'
$migrationsPath = Join-Path $repoRoot 'pb_migrations'
$hooksSource = Join-Path $repoRoot 'pb_hooks'
$expectedZipSha256 = 'D459C5690ABFB8A3E220565671A1B53FDC6ADB21A50A7F553A78BD9EFF5287D5'
$process = $null
$stubProcess = $null
$environmentNames = @(
    'ADMIN_AUTH_HASH_SECRET',
    'ADMIN_AUTH_INTERNAL_SECRET',
    'ADMIN_AUTH_INTERNAL_URL',
    'ADMIN_IP',
    'MAIL_HASH_SECRET',
    'MAIL_INTERNAL_SECRET',
    'ADMIN_SECURITY_TEST_MODE'
)
$previousEnvironment = @{}

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Assert-SafeRunRoot {
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    $resolved = [IO.Path]::GetFullPath($runRoot)
    if (-not $resolved.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe test run root: $resolved"
    }
    return $resolved
}

function Assert-PortFree {
    foreach ($candidate in @($Port, $StubPort)) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start() } finally { $listener.Stop() }
    }
}

function Install-PocketBase {
    if (Test-Path -LiteralPath $PocketBasePath -PathType Leaf) { return }
    $downloadRoot = Split-Path -Parent $PocketBasePath
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    $zipPath = Join-Path $downloadRoot 'pocketbase.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/pocketbase_0.22.21_windows_amd64.zip' -OutFile $zipPath
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    if ($actualHash -cne $expectedZipSha256) {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        throw 'PocketBase download checksum mismatch'
    }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $downloadRoot -Force
    if (-not (Test-Path -LiteralPath $PocketBasePath -PathType Leaf)) {
        throw 'PocketBase executable was not extracted'
    }
}

function Copy-Hooks {
    param([Parameter(Mandatory)][string]$Destination)
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $hooksSource 'require_verified_session.pb.js') -Destination $Destination -Force
    $securityHook = Join-Path $hooksSource 'admin_security.pb.js'
    if (Test-Path -LiteralPath $securityHook -PathType Leaf) {
        Copy-Item -LiteralPath $securityHook -Destination $Destination -Force
    }
    Copy-Item -LiteralPath (Join-Path $hooksSource 'lib') -Destination $Destination -Recurse -Force
    Copy-Item -LiteralPath $fixturePath -Destination (Join-Path $Destination 'step_up_fixture.pb.js') -Force
}

function Wait-Ready {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) {
            $process.WaitForExit()
            $details = @(
                Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
                Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue
            ) -join [Environment]::NewLine
            throw "PocketBase exited early with code $($process.ExitCode): $details"
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
            if ($response.StatusCode -eq 200) { return }
        } catch {}
        Start-Sleep -Milliseconds 200
    }
    throw 'Timed out waiting for PocketBase'
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory)][Net.Http.HttpClient]$Client,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Url,
        [string]$Token = '',
        [hashtable]$Headers = @{},
        $Body = $null
    )
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Url)
    try {
        if ($Token) { [void]$message.Headers.TryAddWithoutValidation('Authorization', $Token) }
        foreach ($name in $Headers.Keys) { [void]$message.Headers.TryAddWithoutValidation($name, [string]$Headers[$name]) }
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 10 -Compress
            $message.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        }
        $response = $Client.SendAsync($message).GetAwaiter().GetResult()
        $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Raw = $raw; Json = if ($raw) { $raw | ConvertFrom-Json } else { $null } }
    } finally {
        $message.Dispose()
    }
}

$resolvedRunRoot = Assert-SafeRunRoot
Install-PocketBase
Assert-PortFree

if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) { throw "Missing fixture: $fixturePath" }
if (-not (Test-Path -LiteralPath $legacySeedFixture -PathType Leaf)) { throw "Missing fixture: $legacySeedFixture" }
if (-not (Test-Path -LiteralPath $stubPath -PathType Leaf)) { throw "Missing fixture: $stubPath" }
$securityModule = Join-Path $hooksSource 'lib\admin_security.js'
if (-not (Test-Path -LiteralPath $securityModule -PathType Leaf)) { throw "Missing security module: $securityModule" }
$securityContract = Get-Content -LiteralPath $securityModule -Raw
foreach ($requiredMarker in @('challengeClientSessionHmac', 'CHALLENGE_BINDING_REQUIRED')) {
    if ($securityContract -notmatch [regex]::Escape($requiredMarker)) {
        throw "Admin security challenge binding contract missing: $requiredMarker"
    }
}
$browserStepUpModule = Join-Path $repoRoot 'astro\src\lib\admin-step-up.ts'
$browserStepUpContract = Get-Content -LiteralPath $browserStepUpModule -Raw
foreach ($requiredMarker in @('X-Admin-Recovery-Code', 'saveAdminRecoveryCode')) {
    if ($browserStepUpContract -notmatch [regex]::Escape($requiredMarker)) {
        throw "Browser recovery contract missing: $requiredMarker"
    }
}
if (Test-Path -LiteralPath $resolvedRunRoot) { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force }
$dataPath = Join-Path $resolvedRunRoot 'pb_data'
$hooksPath = Join-Path $resolvedRunRoot 'pb_hooks'
$emptyMigrationsPath = Join-Path $resolvedRunRoot 'empty_migrations'
$emptyHooksPath = Join-Path $resolvedRunRoot 'empty_hooks'
$preCutoverMigrationsPath = Join-Path $resolvedRunRoot 'pre_cutover_migrations'
$preCutoverHooksPath = Join-Path $resolvedRunRoot 'pre_cutover_hooks'
New-Item -ItemType Directory -Force -Path $dataPath,$emptyMigrationsPath,$emptyHooksPath,$preCutoverMigrationsPath,$preCutoverHooksPath | Out-Null
Get-ChildItem -LiteralPath $migrationsPath -File -Filter '*.pb.js' |
    Where-Object { $_.Name -ne '20260716100500_harden_admin_recovery_cutover.pb.js' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $preCutoverMigrationsPath -Force }
Copy-Item -LiteralPath $legacySeedFixture -Destination (Join-Path $preCutoverHooksPath 'legacy_session_seed.pb.js') -Force
Copy-Hooks -Destination $hooksPath

foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$hashSecret = New-RandomSecret
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_HASH_SECRET', $hashSecret, 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_INTERNAL_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_INTERNAL_URL', "http://127.0.0.1:$StubPort", 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_IP', '127.0.0.1', 'Process')
[Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('MAIL_INTERNAL_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_SECURITY_TEST_MODE', 'true', 'Process')

$stubStdoutPath = Join-Path $resolvedRunRoot 'webauthn-stub.out.log'
$stubStderrPath = Join-Path $resolvedRunRoot 'webauthn-stub.err.log'
$stubProcess = Start-Process -FilePath 'node' -ArgumentList @($stubPath, $StubPort) -WindowStyle Hidden -RedirectStandardOutput $stubStdoutPath -RedirectStandardError $stubStderrPath -PassThru
$stubDeadline = [DateTime]::UtcNow.AddSeconds(15)
while ([DateTime]::UtcNow -lt $stubDeadline) {
    if ($stubProcess.HasExited) { throw 'Deterministic WebAuthn stub exited early' }
    try {
        $stubHealth = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$StubPort/health" -TimeoutSec 1
        if ($stubHealth.StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Milliseconds 100
}
if (-not $stubHealth -or $stubHealth.StatusCode -ne 200) { throw 'Deterministic WebAuthn stub did not become ready' }

$stdoutPath = Join-Path $resolvedRunRoot 'bootstrap.out.log'
$stderrPath = Join-Path $resolvedRunRoot 'bootstrap.err.log'

try {
    $bootstrapArguments = @(
        'serve',
        "--dir=$dataPath",
        "--migrationsDir=$emptyMigrationsPath",
        "--hooksDir=$emptyHooksPath",
        "--http=127.0.0.1:$Port",
        '--dev=false'
    )
    $process = Start-Process -FilePath $PocketBasePath -ArgumentList $bootstrapArguments -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    Wait-Ready
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
    $process.Dispose()
    $process = $null

    $adminEmail = 'track-a-recovery@example.local'
    $adminPassword = 'TrackA-' + (New-RandomSecret)
    & $PocketBasePath admin create $adminEmail $adminPassword "--dir=$dataPath" '--dev=false' | Out-Null

    $stdoutPath = Join-Path $resolvedRunRoot 'pre-cutover.out.log'
    $stderrPath = Join-Path $resolvedRunRoot 'pre-cutover.err.log'
    $preCutoverArguments = @(
        'serve',
        "--dir=$dataPath",
        "--migrationsDir=$preCutoverMigrationsPath",
        "--hooksDir=$preCutoverHooksPath",
        "--http=127.0.0.1:$Port",
        '--dev=false'
    )
    $process = Start-Process -FilePath $PocketBasePath -ArgumentList $preCutoverArguments -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    Wait-Ready
    $seedResponse = Invoke-WebRequest -UseBasicParsing -Method POST -Uri "http://127.0.0.1:$Port/api/test/admin-step-up/seed-legacy"
    if ($seedResponse.StatusCode -ne 200) { throw 'Failed to seed legacy verified session' }
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
    $process.Dispose()
    $process = $null

    $stdoutPath = Join-Path $resolvedRunRoot 'pocketbase.out.log'
    $stderrPath = Join-Path $resolvedRunRoot 'pocketbase.err.log'
    $arguments = @(
        'serve',
        "--dir=$dataPath",
        "--migrationsDir=$migrationsPath",
        "--hooksDir=$hooksPath",
        "--http=127.0.0.1:$Port",
        '--dev=false'
    )
    $process = Start-Process -FilePath $PocketBasePath -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    Wait-Ready

    $client = [Net.Http.HttpClient]::new()
    try {
        $response = $client.GetAsync("http://127.0.0.1:$Port/api/test/admin-step-up/run").GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200) {
            $serverOutput = @(
                Get-Content -LiteralPath $stdoutPath -Tail 40 -ErrorAction SilentlyContinue
                Get-Content -LiteralPath $stderrPath -Tail 40 -ErrorAction SilentlyContinue
            ) -join [Environment]::NewLine
            throw "Admin step-up fixture failed: status=$([int]$response.StatusCode) body=$body server=$serverOutput"
        }
        $result = $body | ConvertFrom-Json
        if ([string]$result.code -cne 'PASS') { throw "Unexpected fixture result: $body" }

        $baseUrl = "http://127.0.0.1:$Port"
        $setup = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/admin-step-up/recovery/setup"
        if ($setup.Status -ne 200) { throw "Recovery setup failed: $($setup.Raw)" }
        $adminAuth = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/admins/auth-with-password" -Body @{ identity = $adminEmail; password = $adminPassword }
        if ($adminAuth.Status -ne 200) { throw 'Temporary admin authentication failed' }
        $adminToken = [string]$adminAuth.Json.token

        $failedRecovery = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/blog-admin/local-recovery" -Token $adminToken -Headers @{ 'X-Test-Fail-Audit' = '1' } -Body @{ email = [string]$setup.Json.email }
        if ($failedRecovery.Status -lt 400) { throw 'Audit failure injection did not fail recovery' }
        $afterFailure = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/admin-step-up/recovery/check" -Body @{ userId = [string]$setup.Json.userId }
        if ($afterFailure.Json.activePasskeys -ne 2 -or $afterFailure.Json.activeStepUps -ne 1 -or $afterFailure.Json.recoveryPending -or $afterFailure.Json.audits -ne 0) {
            throw "Recovery audit rollback failed: $($afterFailure.Raw)"
        }

        $recovery = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/blog-admin/local-recovery" -Token $adminToken -Body @{ email = [string]$setup.Json.email }
        if ($recovery.Status -ne 200 -or -not $recovery.Json.recoveryCode) { throw "Local recovery failed: $($recovery.Raw)" }
        $afterRecovery = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/admin-step-up/recovery/check" -Body @{ userId = [string]$setup.Json.userId }
        if ($afterRecovery.Json.activePasskeys -ne 0 -or $afterRecovery.Json.activeStepUps -ne 0 -or -not $afterRecovery.Json.bootstrapped -or -not $afterRecovery.Json.recoveryPending -or $afterRecovery.Json.audits -ne 1) {
            throw "Local recovery state invalid: $($afterRecovery.Raw)"
        }

        $browserHeaders = @{
            'X-Admin-Session' = [string]$setup.Json.clientSession
            'X-Browser-Fingerprint' = [string]$setup.Json.fingerprint
            'User-Agent' = [string]$setup.Json.userAgent
        }
        $ordinaryOptions = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/blog-admin/passkeys/registration/options" -Token ([string]$setup.Json.token) -Headers $browserHeaders -Body @{}
        if ($ordinaryOptions.Status -ne 403) { throw "Ordinary token unexpectedly reopened recovery: $($ordinaryOptions.Raw)" }
        $browserHeaders['X-Admin-Recovery-Code'] = [string]$recovery.Json.recoveryCode
        $recoveryOptions = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/blog-admin/passkeys/registration/options" -Token ([string]$setup.Json.token) -Headers $browserHeaders -Body @{}
        if ($recoveryOptions.Status -ne 200) { throw "Recovery registration options failed: $($recoveryOptions.Raw)" }
        $recoveryVerify = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/blog-admin/passkeys/registration/verify" -Token ([string]$setup.Json.token) -Headers $browserHeaders -Body @{ response = @{ id = 'recovered-fixture-credential' }; label = 'Recovered' }
        if ($recoveryVerify.Status -ne 200) { throw "Recovery registration verify failed: $($recoveryVerify.Raw)" }
        $replayOptions = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/blog-admin/passkeys/registration/options" -Token ([string]$setup.Json.token) -Headers $browserHeaders -Body @{}
        if ($replayOptions.Status -ne 403) { throw "Recovery code replay unexpectedly succeeded: $($replayOptions.Raw)" }
        $afterReenroll = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/admin-step-up/recovery/check" -Body @{ userId = [string]$setup.Json.userId }
        if ($afterReenroll.Json.activePasskeys -ne 1 -or -not $afterReenroll.Json.bootstrapped -or $afterReenroll.Json.recoveryPending) {
            throw "Recovery reenrollment state invalid: $($afterReenroll.Raw)"
        }

        Write-Host "PASS admin step-up fixture: $($result.observed.Count + 12) scenarios" -ForegroundColor Green
    } finally {
        $client.Dispose()
    }
}
finally {
    if ($null -ne $process) {
        try {
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
            $process.WaitForExit()
        } catch {}
        $process.Dispose()
    }
    if ($null -ne $stubProcess) {
        try {
            if (-not $stubProcess.HasExited) { Stop-Process -Id $stubProcess.Id -Force }
            $stubProcess.WaitForExit()
        } catch {}
        $stubProcess.Dispose()
    }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    if (Test-Path -LiteralPath $resolvedRunRoot) { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force }
}
