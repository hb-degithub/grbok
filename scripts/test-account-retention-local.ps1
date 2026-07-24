param(
    [ValidateSet('schema', 'jobs')]
    [string]$Fixture = 'schema',
    [switch]$All
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$fixturePath = Join-Path $repoRoot 'tests\mail-local\account_retention_fixture.pb.js'
$contractFixturePath = Join-Path $repoRoot 'tests\mail-local\account_retention_integration_contract.js'
$migrationFixturePath = Join-Path $repoRoot 'tests\mail-local\account_retention_migration_fixture.js'

if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
    throw "account retention fixture not found: $fixturePath"
}
if (-not (Test-Path -LiteralPath $contractFixturePath -PathType Leaf)) {
    throw "account retention integration contract fixture not found: $contractFixturePath"
}
if (-not (Test-Path -LiteralPath $migrationFixturePath -PathType Leaf)) {
    throw "account retention migration fixture not found: $migrationFixturePath"
}

& node $contractFixturePath
if ($LASTEXITCODE -ne 0) {
    throw 'account retention integration contract fixture failed'
}

& node $migrationFixturePath
if ($LASTEXITCODE -ne 0) {
    throw 'account retention migration pagination fixture failed'
}

$fixtures = if ($All) { @('schema', 'jobs') } else { @($Fixture) }
foreach ($name in $fixtures) {
    & node $fixturePath $name
    if ($LASTEXITCODE -ne 0) {
        throw "account retention fixture failed: $name"
    }
}

Write-Host "PASS account retention local fixtures: $($fixtures -join ', ')" -ForegroundColor Green
