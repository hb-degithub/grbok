#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $PSScriptRoot 'mail-security-leak-fixture.tmp'

$cases = @(
    @{ Name = 'archive HMAC'; Content = 'MAIL_ARCHIVE_HMAC_SECRET=' + ('a' * 48) },
    @{ Name = 'step-up credential'; Content = 'credential=' + 'v1.' + ('s' * 24) + '.' + ('x' * 43) },
    @{ Name = 'admin client session'; Content = 'X-Admin-Session=' + ('c' * 43) },
    @{ Name = 'age identity'; Content = 'AGE-SECRET-KEY-' + ('1' * 48) },
    @{ Name = 'rclone token'; Content = 'RCLONE_CONFIG_ARCHIVE_TOKEN=' + ('t' * 48) }
)

try {
    foreach ($case in $cases) {
        [IO.File]::WriteAllText($fixture, $case.Content, [Text.UTF8Encoding]::new($false))
        $output = & (Join-Path $PSScriptRoot 'sensitive-check.ps1') 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) {
            throw "sensitive-check failed to reject $($case.Name)"
        }
        Write-Host "PASS rejected $($case.Name)" -ForegroundColor Green
    }
}
finally {
    Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue
}

exit 0
