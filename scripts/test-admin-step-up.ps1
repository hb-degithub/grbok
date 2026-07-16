#Requires -Version 5.1
param(
    [string]$PocketBasePath = (Join-Path $env:TEMP 'pb-0.22.21-track-a\pocketbase.exe'),
    [int]$Port = 18091
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$repoRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $env:TEMP 'blog-admin-step-up-e2e'
$fixturePath = Join-Path $repoRoot 'tests\admin-security\step_up_fixture.pb.js'
$migrationsPath = Join-Path $repoRoot 'pb_migrations'
$hooksSource = Join-Path $repoRoot 'pb_hooks'
$expectedZipSha256 = 'D459C5690ABFB8A3E220565671A1B53FDC6ADB21A50A7F553A78BD9EFF5287D5'
$process = $null
$environmentNames = @(
    'ADMIN_AUTH_HASH_SECRET',
    'ADMIN_AUTH_INTERNAL_SECRET',
    'ADMIN_AUTH_INTERNAL_URL',
    'ADMIN_IP',
    'MAIL_HASH_SECRET',
    'MAIL_INTERNAL_SECRET'
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
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } finally { $listener.Stop() }
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

$resolvedRunRoot = Assert-SafeRunRoot
Install-PocketBase
Assert-PortFree

if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) { throw "Missing fixture: $fixturePath" }
if (Test-Path -LiteralPath $resolvedRunRoot) { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force }
$dataPath = Join-Path $resolvedRunRoot 'pb_data'
$hooksPath = Join-Path $resolvedRunRoot 'pb_hooks'
$emptyMigrationsPath = Join-Path $resolvedRunRoot 'empty_migrations'
$emptyHooksPath = Join-Path $resolvedRunRoot 'empty_hooks'
New-Item -ItemType Directory -Force -Path $dataPath,$emptyMigrationsPath,$emptyHooksPath | Out-Null
Copy-Hooks -Destination $hooksPath

foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$hashSecret = New-RandomSecret
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_HASH_SECRET', $hashSecret, 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_INTERNAL_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_INTERNAL_URL', 'http://127.0.0.1:9', 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_IP', '127.0.0.1', 'Process')
[Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('MAIL_INTERNAL_SECRET', (New-RandomSecret), 'Process')

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
        Write-Host "PASS admin step-up fixture: $($result.observed.Count) scenarios" -ForegroundColor Green
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
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    if (Test-Path -LiteralPath $resolvedRunRoot) { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force }
}
