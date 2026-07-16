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
        throw
    }
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
        Stop-TestPocketBase
        Remove-Item -LiteralPath (Join-Path $hooksRoot 'security_rate_fixture.pb.js') -Force
    }

    if ($RestartPocketBase) {
        $port = Get-FreePort
        $process = Start-TestPocketBase -Port $port
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 5
        if ($health.code -ne 200) { throw 'PocketBase restart health check failed' }
        Stop-TestPocketBase
        Write-Host 'PASS restart persistence process check'
    }
} finally {
    Stop-TestPocketBase
    Remove-Item Env:MAIL_HASH_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:MAIL_INTERNAL_SECRET -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $runRoot) { Remove-Item -LiteralPath $runRoot -Recurse -Force }
}
