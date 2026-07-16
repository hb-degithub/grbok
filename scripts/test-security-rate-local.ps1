#!/usr/bin/env pwsh
param(
    [ValidateSet('policy', 'rate', 'account_mail', 'registration', 'outbox', 'admin_policy')]
    [string]$Fixture = 'policy',
    [switch]$RestartPocketBase,
    [switch]$All,
    [string]$PocketBasePath = 'C:\tmp\pocketbase-v0.22.21\pocketbase.exe'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $repoRoot ('tmp\security-rate-' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $runRoot 'pb_data'
$hooksRoot = Join-Path $runRoot 'pb_hooks'
$migrationsRoot = Join-Path $runRoot 'pb_migrations'
$process = $null

function Ensure-PocketBase {
    if (Test-Path -LiteralPath $PocketBasePath -PathType Leaf) { return }
    $parent = Split-Path -Parent $PocketBasePath
    $zip = Join-Path $parent 'pocketbase.zip'
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/pocketbase_0.22.21_windows_amd64.zip' -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $parent -Force
    Remove-Item -LiteralPath $zip -Force
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

function Start-TestPocketBase {
    param([int]$Port)
    $stdout = Join-Path $runRoot "pocketbase-$Port.out.log"
    $stderr = Join-Path $runRoot "pocketbase-$Port.err.log"
    $env:MAIL_HASH_SECRET = 'LOCAL_TEST_ONLY_MAIL_HASH_SECRET_0123456789'
    $env:MAIL_INTERNAL_SECRET = 'LOCAL_TEST_ONLY_MAIL_INTERNAL_SECRET_012345'
    $env:MAIL_GATEWAY_ENABLED = 'true'
    $env:MAIL_ACCOUNT_ENABLED = 'true'
    $env:MAIL_OTP_ENABLED = 'true'
    $env:MAIL_GATEWAY_INTERNAL_URL = "http://127.0.0.1:$Port"
    $env:BLOG_AUTH_LOOPBACK_BASE = "http://127.0.0.1:$Port"
    $env:PUBLIC_SITE_URL = 'http://localhost:4321'
    $args = @(
        'serve',
        "--dir=$dataRoot",
        "--hooksDir=$hooksRoot",
        "--migrationsDir=$migrationsRoot",
        "--http=127.0.0.1:$Port"
    )
    $started = Start-Process -FilePath $PocketBasePath -ArgumentList $args -WorkingDirectory $runRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($started.HasExited) {
            $started.Refresh()
            throw "PocketBase exited early ($($started.ExitCode))`nSTDOUT:`n$([IO.File]::ReadAllText($stdout))`nSTDERR:`n$([IO.File]::ReadAllText($stderr))"
        }
        try {
            $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
            if ($health.code -eq 200) { return $started }
        } catch {}
        Start-Sleep -Milliseconds 150
    }
    throw "PocketBase did not become healthy`n$([IO.File]::ReadAllText($stderr))"
}

function Stop-TestPocketBase {
    if ($null -ne $script:process -and -not $script:process.HasExited) {
        Stop-Process -Id $script:process.Id -Force
        $script:process.WaitForExit(5000) | Out-Null
    }
    $script:process = $null
}

function Invoke-Fixture {
    param([string]$Name, [int]$Port)
    $routes = @{
        policy = '/api/test/security-rate/policy'
        rate = '/api/test/security-rate/rate'
        account_mail = '/api/test/security-rate/account-mail'
        registration = '/api/test/security-rate/registration'
        outbox = '/api/test/security-rate/outbox'
        admin_policy = '/api/test/security-rate/admin-policy'
    }
    try {
        return Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:$Port" + $routes[$Name]) -TimeoutSec 60
    } catch {
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
        Get-ChildItem -LiteralPath $runRoot -File -Filter 'pocketbase-*.out.log' -ErrorAction SilentlyContinue | ForEach-Object { Get-Content -LiteralPath $_.FullName }
        Get-ChildItem -LiteralPath $runRoot -File -Filter 'pocketbase-*.err.log' -ErrorAction SilentlyContinue | ForEach-Object { Get-Content -LiteralPath $_.FullName }
        throw
    }
}

function Invoke-RateConcurrency {
    param([int]$Port)
    Add-Type -AssemblyName System.Net.Http
    $client = [Net.Http.HttpClient]::new()
    try {
        $uri = "http://127.0.0.1:$Port/api/test/security-rate/rate/consume"
        $tasks = @()
        for ($i = 0; $i -lt 20; $i++) {
            $content = [Net.Http.StringContent]::new('{"email":"reader@example.com","ip":"192.0.2.10"}', [Text.Encoding]::UTF8, 'application/json')
            $tasks += $client.PostAsync($uri, $content)
        }
        [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$tasks)
        $allowed = 0
        foreach ($task in $tasks) {
            $raw = $task.Result.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $parsed = $raw | ConvertFrom-Json
            if ($parsed.result.allowed) { $allowed++ }
        }
        if ($allowed -ne 2) { throw "concurrency oversold/undersold account_mail_email: expected 2, got $allowed" }
        $summary = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/rate/summary?email=reader%40example.com&ip=192.0.2.10" -TimeoutSec 10
        if ($summary.counts.account_mail_email -ne 2 -or $summary.counts.account_mail_ip -ne 2 -or $summary.counts.account_mail_global -ne 2) {
            throw "partial bucket writes after concurrency: $($summary | ConvertTo-Json -Compress -Depth 5)"
        }
        Write-Host 'PASS rate concurrency: 2/20 allowed, all three buckets contain 2 events'
    } finally {
        $client.Dispose()
    }
}

function Invoke-JsonPost {
    param([int]$Port, [string]$Path, [hashtable]$Body)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ("http://127.0.0.1:$Port" + $Path) -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 20
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = ($response.Content | ConvertFrom-Json); ElapsedMs = $watch.ElapsedMilliseconds }
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        $raw = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { '{}' }
        return [pscustomobject]@{ Status = $status; Body = ($raw | ConvertFrom-Json); ElapsedMs = $watch.ElapsedMilliseconds }
    } finally {
        $watch.Stop()
    }
}

function Assert-PublicMailResponse {
    param($Response, [string]$Label)
    if ($Response.Status -ne 202) { throw "$Label expected 202, got $($Response.Status): $($Response.Body | ConvertTo-Json -Compress -Depth 5)" }
    $keys = @($Response.Body.PSObject.Properties.Name | Sort-Object)
    $expected = @('accepted', 'code', 'message', 'referenceId')
    if (($keys -join ',') -ne ($expected -join ',')) { throw "$Label response keys mismatch: $($keys -join ',')" }
    if ($Response.Body.accepted -ne $true -or $Response.Body.code -ne 'MAIL_REQUEST_ACCEPTED') { throw "$Label response code mismatch" }
    if ([string]$Response.Body.referenceId -notmatch '^[A-Za-z0-9_-]{22}$') { throw "$Label referenceId shape mismatch" }
    if ($Response.ElapsedMs -lt 330) { throw "$Label completed too quickly: $($Response.ElapsedMs)ms" }
}

function Invoke-AccountMailScenarios {
    param([int]$Port, $Setup)
    $existing = Invoke-JsonPost -Port $Port -Path '/api/blog-auth/password-reset/request' -Body @{ email = [string]$Setup.existing }
    $missing1 = Invoke-JsonPost -Port $Port -Path '/api/blog-auth/password-reset/request' -Body @{ email = 'missing@example.com' }
    Assert-PublicMailResponse $existing 'existing'
    Assert-PublicMailResponse $missing1 'missing'
    if ($existing.Body.message.Length -ne $missing1.Body.message.Length) { throw 'existing/missing message byte shape differs' }

    $missing2 = Invoke-JsonPost -Port $Port -Path '/api/blog-auth/verification/request' -Body @{ email = 'missing@example.com' }
    $limited = Invoke-JsonPost -Port $Port -Path '/api/blog-auth/password-reset/request' -Body @{ email = 'missing@example.com' }
    Assert-PublicMailResponse $missing2 'missing second quota'
    Assert-PublicMailResponse $limited 'email limited'

    $otp = Invoke-JsonPost -Port $Port -Path '/api/blog-auth/otp/request' -Body @{ email = 'unknown-otp@example.com' }
    if ($otp.Status -ne 202 -or [string]$otp.Body.challengeId -notmatch '^[A-Za-z0-9_-]{32}$') { throw 'fake OTP response mismatch' }
    if ($otp.ElapsedMs -lt 330) { throw "OTP completed too quickly: $($otp.ElapsedMs)ms" }

    $state = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/account-mail/state" -TimeoutSec 10
    if ($state.logs.Count -ne 1 -or $state.challenges -ne 0) { throw "decoy/limited request wrote persistent data: $($state | ConvertTo-Json -Compress -Depth 6)" }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/account-mail/reset-buckets" -TimeoutSec 10 | Out-Null
    $gatewayFailure = Invoke-JsonPost -Port $Port -Path '/api/blog-auth/password-reset/request' -Body @{ email = [string]$Setup.gatewayFailure }
    Assert-PublicMailResponse $gatewayFailure 'gateway failure'
    $state = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/account-mail/state" -TimeoutSec 10
    if ($state.logs.Count -ne 2 -or $state.logs[1].result -ne 'failed') { throw 'real failed delivery was not minimally logged' }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/account-mail/reset-buckets" -TimeoutSec 10 | Out-Null
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/account-mail/corrupt" -TimeoutSec 10 | Out-Null
    $unavailable = Invoke-JsonPost -Port $Port -Path '/api/blog-auth/password-reset/request' -Body @{ email = 'corrupt@example.com' }
    Assert-PublicMailResponse $unavailable 'SQLite unavailable'
    $after = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/account-mail/state" -TimeoutSec 10
    if ($after.logs.Count -ne 2 -or $after.challenges -ne 0) { throw 'unavailable request wrote log/challenge' }
    Write-Host 'PASS account-mail parity, shared quotas, fake OTP, zero-write, and minimal logs'
}

function Invoke-RegistrationPost {
    param([int]$Port, [string]$Email, [string]$Ip = '192.0.2.10')
    $headers = @{ 'X-Test-IP' = $Ip }
    $body = @{ name = 'Reader'; email = $Email; password = 'Test12345!'; passwordConfirm = 'Test12345!' }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/register" -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 20
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = ($response.Content | ConvertFrom-Json) }
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        $raw = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { '{}' }
        return [pscustomobject]@{ Status = $status; Body = ($raw | ConvertFrom-Json) }
    }
}

function Invoke-RegistrationConsume {
    param([int]$Port, [string]$Ip, [long]$NowMs)
    return Invoke-JsonPost -Port $Port -Path '/api/test/security-rate/registration/consume' -Body @{ ip = $Ip; nowMs = $NowMs }
}

function Invoke-RegistrationScenarios {
    param([int]$Port)
    $now = 1720828800000
    for ($i = 1; $i -le 3; $i++) {
        $result = Invoke-RegistrationConsume -Port $Port -Ip '192.0.2.10' -NowMs $now
        if ($result.Status -ne 200) { throw "registration IPv4 request $i unexpectedly denied: $($result.Status) $($result.Body | ConvertTo-Json -Compress -Depth 5)" }
    }
    $fourth = Invoke-RegistrationConsume -Port $Port -Ip '192.0.2.10' -NowMs $now
    if ($fourth.Status -ne 429 -or $fourth.Body.code -ne 'REGISTRATION_RATE_LIMITED') { throw 'registration IPv4 fourth request was not limited' }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/reset" -TimeoutSec 10 | Out-Null
    for ($i = 1; $i -le 10; $i++) {
        $result = Invoke-RegistrationConsume -Port $Port -Ip ("2001:db8:abcd:42::{0}" -f $i) -NowMs $now
        if ($result.Status -ne 200) { throw "registration IPv6 /64 request $i unexpectedly denied" }
    }
    $eleventh = Invoke-RegistrationConsume -Port $Port -Ip '2001:db8:abcd:42::11' -NowMs $now
    if ($eleventh.Status -ne 429) { throw 'registration IPv6 /64 eleventh request was not limited' }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/reset" -TimeoutSec 10 | Out-Null
    for ($i = 1; $i -le 20; $i++) {
        $result = Invoke-RegistrationConsume -Port $Port -Ip ("198.51.100.{0}" -f $i) -NowMs $now
        if ($result.Status -ne 200) { throw "registration global request $i unexpectedly denied" }
    }
    $twentyFirst = Invoke-RegistrationConsume -Port $Port -Ip '203.0.113.21' -NowMs $now
    if ($twentyFirst.Status -ne 429) { throw 'registration global twenty-first request was not limited' }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/reset" -TimeoutSec 10 | Out-Null
    Add-Type -AssemblyName System.Net.Http
    $client = [Net.Http.HttpClient]::new()
    try {
        $tasks = @()
        for ($i = 0; $i -lt 20; $i++) {
            $content = [Net.Http.StringContent]::new('{"ip":"192.0.2.77","nowMs":1720828800000}', [Text.Encoding]::UTF8, 'application/json')
            $tasks += $client.PostAsync("http://127.0.0.1:$Port/api/test/security-rate/registration/consume", $content)
        }
        [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$tasks)
        $allowed = @($tasks | Where-Object { [int]$_.Result.StatusCode -eq 200 }).Count
        if ($allowed -ne 3) { throw "registration concurrency expected exactly 3 successes, got $allowed" }
    } finally { $client.Dispose() }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/reset" -TimeoutSec 10 | Out-Null
    $first = Invoke-RegistrationPost -Port $Port -Email 'registration-reader@example.com'
    $duplicate = Invoke-RegistrationPost -Port $Port -Email 'registration-reader@example.com' -Ip '192.0.2.11'
    if ($first.Status -ne 202 -or $duplicate.Status -ne 202 -or $first.Body.code -ne 'REGISTRATION_SUBMITTED' -or $duplicate.Body.code -ne 'REGISTRATION_SUBMITTED') { throw 'duplicate registration response parity failed' }
    $state = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/state" -TimeoutSec 10
    if ($state.users -ne 1) { throw "duplicate registration created $($state.users) users" }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/reset" -TimeoutSec 10 | Out-Null
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/prime-mail" -ContentType 'application/json' -Body '{"email":"mail-quota-full@example.com","ip":"192.0.2.90"}' -TimeoutSec 10 | Out-Null
    $logsBefore = (Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/state" -TimeoutSec 10).logs
    $suppressed = Invoke-RegistrationPost -Port $Port -Email 'mail-quota-full@example.com' -Ip '192.0.2.90'
    $suppressedState = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/state" -TimeoutSec 10
    if ($suppressed.Status -ne 202 -or $suppressedState.users -ne 2 -or $suppressedState.logs -ne $logsBefore) { throw 'mail quota full did not preserve user while suppressing automatic verification' }

    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/corrupt" -ContentType 'application/json' -Body '{"ip":"192.0.2.250"}' -TimeoutSec 10 | Out-Null
    $before = (Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/state" -TimeoutSec 10).users
    $unavailable = Invoke-RegistrationPost -Port $Port -Email 'store-failure@example.com' -Ip '192.0.2.250'
    $after = (Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/registration/state" -TimeoutSec 10).users
    if ($unavailable.Status -ne 503 -or $unavailable.Body.code -ne 'REGISTRATION_UNAVAILABLE' -or $after -ne $before) { throw 'registration store failure did not fail closed' }
    Write-Host 'PASS registration IPv4, IPv6 /64, global, concurrency, duplicate parity, mail suppression, and fail-closed storage'
}

try {
    Ensure-PocketBase
    New-Item -ItemType Directory -Force -Path $dataRoot, $hooksRoot, $migrationsRoot | Out-Null
    $bootstrapPort = Get-FreePort
    $process = Start-TestPocketBase -Port $bootstrapPort
    Stop-TestPocketBase
    Copy-Item -Path (Join-Path $repoRoot 'pb_hooks\*') -Destination $hooksRoot -Recurse -Force
    Copy-Item -Path (Join-Path $repoRoot 'pb_migrations\*') -Destination $migrationsRoot -Recurse -Force
    $fixtures = if ($All) { @('policy', 'rate', 'account_mail', 'registration', 'outbox', 'admin_policy') } else { @($Fixture) }
    foreach ($name in $fixtures) {
        $fixturePath = Join-Path $repoRoot ("tests\security-rate\${name}_fixture.pb.js")
        if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) { throw "fixture missing: $fixturePath" }
        Copy-Item -LiteralPath $fixturePath -Destination (Join-Path $hooksRoot 'security_rate_fixture.pb.js') -Force
        $port = Get-FreePort
        $process = Start-TestPocketBase -Port $port
        $result = Invoke-Fixture -Name $name -Port $port
        if (-not $result.ok) { throw "$name fixture returned failure" }
        Write-Host ("PASS {0}: {1}" -f $name, ($result | ConvertTo-Json -Compress -Depth 8))
        if ($name -eq 'rate') {
            Invoke-RateConcurrency -Port $port
            if ($RestartPocketBase) {
                Stop-TestPocketBase
                $port = Get-FreePort
                $process = Start-TestPocketBase -Port $port
                $summary = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/test/security-rate/rate/summary?email=reader%40example.com&ip=192.0.2.10" -TimeoutSec 10
                if ($summary.counts.account_mail_email -ne 2 -or $summary.counts.account_mail_ip -ne 2 -or $summary.counts.account_mail_global -ne 2) {
                    throw "rate buckets did not persist across restart: $($summary | ConvertTo-Json -Compress -Depth 5)"
                }
                Write-Host 'PASS rate restart persistence: all three buckets retained 2 events'
            }
        }
        if ($name -eq 'account_mail') { Invoke-AccountMailScenarios -Port $port -Setup $result }
        if ($name -eq 'registration') { Invoke-RegistrationScenarios -Port $port }
        Stop-TestPocketBase
        Remove-Item -LiteralPath (Join-Path $hooksRoot 'security_rate_fixture.pb.js') -Force
    }

    if ($RestartPocketBase -and -not ($fixtures -contains 'rate')) {
        if ($fixtures -contains 'registration') {
            Copy-Item -LiteralPath (Join-Path $repoRoot 'tests\security-rate\registration_fixture.pb.js') -Destination (Join-Path $hooksRoot 'security_rate_fixture.pb.js') -Force
        }
        $port = Get-FreePort
        $process = Start-TestPocketBase -Port $port
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 5
        if ($health.code -ne 200) { throw 'PocketBase restart health check failed' }
        if ($fixtures -contains 'registration') {
            $restartNow = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            for ($i = 1; $i -le 3; $i++) {
                $persist = Invoke-RegistrationConsume -Port $port -Ip '203.0.113.99' -NowMs $restartNow
                if ($persist.Status -ne 200) { throw 'registration restart setup failed' }
            }
            Stop-TestPocketBase
            $port = Get-FreePort
            $process = Start-TestPocketBase -Port $port
            $persist = Invoke-RegistrationConsume -Port $port -Ip '203.0.113.99' -NowMs $restartNow
            if ($persist.Status -ne 429) { throw 'registration quota did not persist across restart' }
            Write-Host 'PASS registration restart persistence'
        }
        Stop-TestPocketBase
        Write-Host 'PASS restart persistence process check'
    }
} finally {
    Stop-TestPocketBase
    Remove-Item Env:MAIL_HASH_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:MAIL_INTERNAL_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:MAIL_GATEWAY_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:MAIL_ACCOUNT_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:MAIL_OTP_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:MAIL_GATEWAY_INTERNAL_URL -ErrorAction SilentlyContinue
    Remove-Item Env:BLOG_AUTH_LOOPBACK_BASE -ErrorAction SilentlyContinue
    Remove-Item Env:PUBLIC_SITE_URL -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $runRoot) { Remove-Item -LiteralPath $runRoot -Recurse -Force }
}
