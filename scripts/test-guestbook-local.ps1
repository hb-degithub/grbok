#Requires -Version 5.1
param(
    [string]$PocketBasePath = 'C:\tmp\pocketbase-v0.22.21\pocketbase.exe',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$repoRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $repoRoot ('tmp\guestbook-' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $runRoot 'pb_data'
$hooksRoot = Join-Path $runRoot 'pb_hooks'
$migrationsRoot = Join-Path $runRoot 'pb_migrations'
$fixturePath = Join-Path $repoRoot 'tests\frontend-backend\guestbook_fixture.pb.js'
$process = $null
$client = $null
$previousMailHashSecret = [Environment]::GetEnvironmentVariable('MAIL_HASH_SECRET', 'Process')
$expectedZipSha256 = 'D459C5690ABFB8A3E220565671A1B53FDC6ADB21A50A7F553A78BD9EFF5287D5'

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

function Normalize-ProcessPath {
    $parts = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) | Where-Object { $_ }
    [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'Process')
}

function Ensure-PocketBase {
    if (Test-Path -LiteralPath $PocketBasePath -PathType Leaf) { return }
    if ($Offline) { throw "PocketBase binary is unavailable in offline mode: $PocketBasePath" }
    $parent = Split-Path -Parent $PocketBasePath
    $zip = Join-Path $parent 'pocketbase.zip'
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/pocketbase_0.22.21_windows_amd64.zip' -OutFile $zip
    $actualHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    if ($actualHash -cne $expectedZipSha256) {
        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
        throw 'PocketBase download checksum mismatch'
    }
    Expand-Archive -LiteralPath $zip -DestinationPath $parent -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $PocketBasePath -PathType Leaf)) {
        throw "PocketBase 0.22.21 download did not produce $PocketBasePath"
    }
}

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function Assert-SafeRunRoot {
    $resolvedRoot = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\')
    $resolvedRun = [IO.Path]::GetFullPath($runRoot)
    if (-not $resolvedRun.StartsWith($resolvedRoot + '\tmp\guestbook-', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe guestbook test root: $resolvedRun"
    }
}

function Copy-TestFiles {
    New-Item -ItemType Directory -Force -Path $dataRoot, $hooksRoot, $migrationsRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'pb_hooks\lib') -Destination $hooksRoot -Recurse -Force
    $guestbookHook = Join-Path $repoRoot 'pb_hooks\validate_guestbook.pb.js'
    if (Test-Path -LiteralPath $guestbookHook -PathType Leaf) {
        Copy-Item -LiteralPath $guestbookHook -Destination $hooksRoot -Force
    }
    Copy-Item -LiteralPath $fixturePath -Destination (Join-Path $hooksRoot 'guestbook_fixture.pb.js') -Force
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'pb_migrations') -File -Filter '*.pb.js' |
        Where-Object { $_.Name -notin @('20260718100000_extend_page_views_friend_target.pb.js', '20260718102000_create_gallery_items.pb.js') } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $migrationsRoot -Force }
}

function Start-TestPocketBase {
    param([int]$Port)
    $stdout = Join-Path $runRoot 'pocketbase.out.log'
    $stderr = Join-Path $runRoot 'pocketbase.err.log'
    $arguments = @(
        'serve',
        "--dir=$dataRoot",
        "--hooksDir=$hooksRoot",
        "--migrationsDir=$migrationsRoot",
        "--http=127.0.0.1:$Port"
    )
    $started = Start-Process -FilePath $PocketBasePath -ArgumentList $arguments -WorkingDirectory $runRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($started.HasExited) {
            $started.Refresh()
            $details = [IO.File]::ReadAllText($stdout) + [Environment]::NewLine + [IO.File]::ReadAllText($stderr)
            throw "PocketBase exited early ($($started.ExitCode)) $details"
        }
        try {
            $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
            if ($health.code -eq 200) { return $started }
        } catch {}
        Start-Sleep -Milliseconds 150
    }
    throw "PocketBase did not become healthy: $([IO.File]::ReadAllText($stderr))"
}

function Stop-TestPocketBase {
    if ($null -ne $process) {
        try {
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
            $process.WaitForExit(5000) | Out-Null
        } catch {}
        $process.Dispose()
    }
    $script:process = $null
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Url,
        $Body = $null
    )
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Url)
    try {
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 10 -Compress
            $message.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        }
        $response = $client.SendAsync($message).GetAwaiter().GetResult()
        try {
            $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            return [pscustomobject]@{
                Status = [int]$response.StatusCode
                Raw = $raw
                Json = if ($raw) { $raw | ConvertFrom-Json } else { $null }
            }
        } finally {
            $response.Dispose()
        }
    } finally {
        $message.Dispose()
    }
}

function Start-JsonRequest {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)]$Body
    )
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Url)
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $message.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
    return [pscustomobject]@{ Message = $message; Task = $client.SendAsync($message) }
}

function Complete-JsonRequest {
    param([Parameter(Mandatory)]$Pending)
    try {
        $response = $Pending.Task.GetAwaiter().GetResult()
        try {
            $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            return [pscustomobject]@{
                Status = [int]$response.StatusCode
                Raw = $raw
                Json = if ($raw) { $raw | ConvertFrom-Json } else { $null }
            }
        } finally {
            $response.Dispose()
        }
    } finally {
        $Pending.Message.Dispose()
    }
}

function Assert-Status {
    param($Response, [int]$Expected, [string]$Label)
    if ($Response.Status -ne $Expected) {
        throw "$Label expected HTTP $Expected, got $($Response.Status): $($Response.Raw)"
    }
}

function Assert-ErrorCode {
    param($Response, [string]$Expected, [string]$Label)
    $code = ''
    if ($null -ne $Response.Json) {
        if ($Response.Json.code -is [string]) { $code = [string]$Response.Json.code }
        if (-not $code -and $Response.Json.data -and $Response.Json.data.code -is [string]) { $code = [string]$Response.Json.data.code }
        if (-not $code -and $Response.Json.data -and $Response.Json.data.code -and $Response.Json.data.code.code) { $code = [string]$Response.Json.data.code.code }
        if (-not $code -and $Response.Json.message) { $code = ([string]$Response.Json.message).TrimEnd('.').Split('|')[0] }
    }
    if ($code -ne $Expected) {
        throw "$Label expected code $Expected, got '$code': $($Response.Raw)"
    }
}

function New-GuestbookMessage {
    param([string]$BaseUrl, [int]$Index, [string]$Nickname = '', [string]$Content = '')
    if (-not $Nickname) { $Nickname = "Reader $Index" }
    if (-not $Content) { $Content = "Guestbook message $Index" }
    return Invoke-JsonRequest -Method POST -Url "$BaseUrl/api/collections/guestbook_messages/records" -Body @{
        nickname = $Nickname
        content = $Content
        status = 'hidden'
    }
}

Assert-SafeRunRoot
Ensure-PocketBase
if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) { throw "Missing guestbook fixture: $fixturePath" }
if (Test-Path -LiteralPath $runRoot) { Remove-Item -LiteralPath $runRoot -Recurse -Force }
Normalize-ProcessPath
[Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', (New-RandomSecret), 'Process')

try {
    New-Item -ItemType Directory -Force -Path $dataRoot, $hooksRoot, $migrationsRoot | Out-Null
    $bootstrapPort = Get-FreePort
    $process = Start-TestPocketBase -Port $bootstrapPort
    Stop-TestPocketBase
    Copy-TestFiles
    $port = Get-FreePort
    $process = Start-TestPocketBase -Port $port
    $baseUrl = "http://127.0.0.1:$port"
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(30)

    $contract = Invoke-JsonRequest -Method GET -Url "$baseUrl/api/test/guestbook/contract"
    Assert-Status $contract 200 'guestbook contract'
    if (-not $contract.Json.ok) { throw "guestbook contract failed: $($contract.Raw)" }

    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/reset") 200 'initial reset'
    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/seed-hidden") 200 'hidden seed'
    $first = New-GuestbookMessage -BaseUrl $baseUrl -Index 1 -Nickname '<b>Reader One</b>' -Content '<p>Hello guestbook</p>'
    Assert-Status $first 200 'first create'
    if ($first.Json.nickname -ne 'Reader One' -or $first.Json.content -ne 'Hello guestbook' -or $first.Json.status -ne 'show') {
        throw "guestbook sanitization/default mismatch: $($first.Raw)"
    }
    $visible = Invoke-JsonRequest -Method GET -Url "$baseUrl/api/collections/guestbook_messages/records?perPage=200&sort=created"
    Assert-Status $visible 200 'public list'
    $statuses = @($visible.Json.items | ForEach-Object { [string]$_.status })
    if ($statuses.Count -ne 1 -or $statuses[0] -ne 'show') { throw "public visible statuses mismatch: $($visible.Raw)" }
    $publicUpdate = Invoke-JsonRequest -Method PATCH -Url "$baseUrl/api/collections/guestbook_messages/records/$($first.Json.id)" -Body @{ content = 'unauthorized update' }
    Assert-Status $publicUpdate 404 'public update'
    $publicDelete = Invoke-JsonRequest -Method DELETE -Url "$baseUrl/api/collections/guestbook_messages/records/$($first.Json.id)"
    Assert-Status $publicDelete 404 'public delete'

    $firstFiveStatuses = @($first.Status)
    foreach ($index in 2..5) { $firstFiveStatuses += (New-GuestbookMessage -BaseUrl $baseUrl -Index $index).Status }
    if (($firstFiveStatuses -join ',') -ne '200,200,200,200,200') { throw "first five create statuses mismatch: $($firstFiveStatuses -join ',')" }
    $sixth = New-GuestbookMessage -BaseUrl $baseUrl -Index 6
    Assert-Status $sixth 429 'sixth create'
    Assert-ErrorCode $sixth 'GUESTBOOK_RATE_LIMITED' 'sixth create'
    $retryAfter = 0
    if ($sixth.Json.retryAfter) { $retryAfter = [int]$sixth.Json.retryAfter }
    if (-not $retryAfter -and $sixth.Json.data -and $sixth.Json.data.retryAfter -and $sixth.Json.data.retryAfter.message) {
        $retryAfter = [int](([string]$sixth.Json.data.retryAfter.message).TrimEnd('.'))
    }
    $helpPresent = [bool]$sixth.Json.help -or [bool]($sixth.Json.data -and $sixth.Json.data.help)
    if ($retryAfter -lt 1 -or $helpPresent) {
        throw "sixth create retryAfter/dead-help mismatch: $($sixth.Raw)"
    }
    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/backdate") 200 'backdate window'
    Assert-Status (New-GuestbookMessage -BaseUrl $baseUrl -Index 7) 200 'after-window create'

    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/reset") 200 'plain-text round-trip reset'
    $plainText = New-GuestbookMessage -BaseUrl $baseUrl -Index 8 -Content '2 < 3 > 1'
    Assert-Status $plainText 200 'plain-text angle-bracket create'
    if ([string]$plainText.Json.content -cne '2 < 3 > 1') {
        throw "plain-text angle-bracket content was rewritten: $($plainText.Raw)"
    }

    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/reset") 200 'validation reset'
    $invalidCases = @(
        (New-GuestbookMessage -BaseUrl $baseUrl -Index 20 -Nickname '<b></b>' -Content 'valid'),
        (New-GuestbookMessage -BaseUrl $baseUrl -Index 21 -Content 'https://a.test https://b.test https://c.test'),
        (New-GuestbookMessage -BaseUrl $baseUrl -Index 22 -Content (('x' * 25) -join '')),
        (New-GuestbookMessage -BaseUrl $baseUrl -Index 23 -Content ("control$([char]1)value")),
        (New-GuestbookMessage -BaseUrl $baseUrl -Index 24 -Nickname ("bad$([char]1)name") -Content 'valid'),
        (New-GuestbookMessage -BaseUrl $baseUrl -Index 25 -Nickname ("bad$([char]127)name") -Content 'valid')
    )
    foreach ($invalid in $invalidCases) {
        Assert-Status $invalid 400 'invalid guestbook create'
        Assert-ErrorCode $invalid 'GUESTBOOK_INVALID' 'invalid guestbook create'
    }
    $validationStorage = Invoke-JsonRequest -Method GET -Url "$baseUrl/api/test/guestbook/storage"
    if ($validationStorage.Json.messages -ne 0 -or $validationStorage.Json.buckets -ne 0) {
        throw "invalid requests consumed quota or wrote messages: $($validationStorage.Raw)"
    }

    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/reset") 200 'concurrency reset'
    $pending = @()
    foreach ($index in 1..20) {
        $pending += Start-JsonRequest -Method POST -Url "$baseUrl/api/collections/guestbook_messages/records" -Body @{
            nickname = "Concurrent $index"
            content = "Concurrent guestbook message $index"
            status = 'show'
        }
    }
    $concurrent = @($pending | ForEach-Object { Complete-JsonRequest $_ })
    $successes = @($concurrent | Where-Object { $_.Status -eq 200 }).Count
    $limited = @($concurrent | Where-Object { $_.Status -eq 429 }).Count
    $unexpected = @($concurrent | Where-Object { $_.Status -notin @(200, 429) })
    if ($successes -ne 5 -or $limited -ne 15 -or $unexpected.Count -ne 0) {
        throw "concurrency mismatch successes=$successes limited=$limited unexpected=$($unexpected.Count)"
    }
    $storage = Invoke-JsonRequest -Method GET -Url "$baseUrl/api/test/guestbook/storage"
    Assert-Status $storage 200 'storage scan'
    if ($storage.Json.messages -ne 5 -or $storage.Json.buckets -ne 1 -or $storage.Json.rawIpFoundInGuestbookRows -or $storage.Json.rawIpFoundInBucketRows) {
        throw "guestbook storage privacy mismatch: $($storage.Raw)"
    }

    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/reset") 200 'corruption reset'
    Assert-Status (New-GuestbookMessage -BaseUrl $baseUrl -Index 30) 200 'corruption prime'
    $corrupt = Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/corrupt"
    Assert-Status $corrupt 200 'corrupt bucket'
    $corruptCreate = New-GuestbookMessage -BaseUrl $baseUrl -Index 31
    Assert-Status $corruptCreate 503 'corrupt bucket create'
    Assert-ErrorCode $corruptCreate 'GUESTBOOK_UNAVAILABLE' 'corrupt bucket create'
    $afterCorrupt = Invoke-JsonRequest -Method GET -Url "$baseUrl/api/test/guestbook/storage"
    if ($afterCorrupt.Json.messages -ne $corrupt.Json.messages) { throw "corrupt bucket create wrote a message: $($afterCorrupt.Raw)" }

    Assert-Status (Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/reset") 200 'policy update reset'
    $policySix = Invoke-JsonRequest -Method POST -Url "$baseUrl/api/test/guestbook/policy-six"
    Assert-Status $policySix 200 'policy limit six'
    if ($policySix.Json.policy.limit -ne 6 -or $policySix.Json.policy.windowSeconds -ne 3600) { throw "policy six mismatch: $($policySix.Raw)" }
    $sixStatuses = @()
    foreach ($index in 40..45) { $sixStatuses += (New-GuestbookMessage -BaseUrl $baseUrl -Index $index).Status }
    if (($sixStatuses -join ',') -ne '200,200,200,200,200,200') { throw "limit-six statuses mismatch: $($sixStatuses -join ',')" }
    $seventh = New-GuestbookMessage -BaseUrl $baseUrl -Index 46
    Assert-Status $seventh 429 'limit-six seventh create'
    $constraints = Invoke-JsonRequest -Method GET -Url "$baseUrl/api/test/guestbook/policy-constraints"
    Assert-Status $constraints 200 'policy constraints'
    if (-not $constraints.Json.ok) { throw "policy constraints failed: $($constraints.Raw)" }

    Write-Host 'PASS guestbook durable exact rolling quota: contract, visibility, validation, concurrency, privacy, corruption, and policy CAS' -ForegroundColor Green
}
finally {
    if ($null -ne $client) { $client.Dispose() }
    Stop-TestPocketBase
    [Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', $previousMailHashSecret, 'Process')
    if (Test-Path -LiteralPath $runRoot) {
        Assert-SafeRunRoot
        Remove-Item -LiteralPath $runRoot -Recurse -Force
    }
}
