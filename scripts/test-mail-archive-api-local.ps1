$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $repoRoot 'tests\mail-local\archive_retention_fixture.pb.js'

if (-not (Test-Path -LiteralPath $fixture -PathType Leaf)) {
    throw "mail archive fixture not found: $fixture"
}

& node $fixture
if ($LASTEXITCODE -ne 0) {
    throw 'mail archive API fixture failed'
}

Write-Host 'PASS mail archive API local fixture' -ForegroundColor Green
