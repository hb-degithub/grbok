#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$scanner = Join-Path $PSScriptRoot 'sensitive-check.ps1'
$fixture = Join-Path $PSScriptRoot 'mail-security-leak-fixture.tmp'
$plaintext = Join-Path $PSScriptRoot 'mail-archive-plaintext-canary.jsonl'
$distCanary = Join-Path $repoRoot 'astro\dist\mail-security-scan-canary.js'
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "SENSITIVE_CHECK_TEST: $Message" }
}

function Invoke-Scanner {
    $shell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $arguments = @('-NoProfile')
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $arguments += @('-ExecutionPolicy', 'Bypass')
    }
    $arguments += @('-File', $scanner)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = $null
        $output = @(& $shell @arguments 2>&1)
        $exitCode = $global:LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    return [pscustomobject]@{ ExitCode = [int]$exitCode; Output = @($output | ForEach-Object { [string]$_ }) }
}

$mailHashName = 'MAIL_' + 'HASH_SECRET'
$archiveHmacName = 'MAIL_ARCHIVE_' + 'HMAC_SECRET'
$ageIdentityName = 'MAIL_ARCHIVE_AGE_' + 'IDENTITY'
$rcloneTokenName = 'RCLONE_CONFIG_ARCHIVE_' + 'TOKEN'
$dollarBrace = [string][char]36 + '{'

try {
    $bad = [System.Collections.Generic.List[string]]::new()
    $bad.Add($mailHashName + '=' + $dollarBrace + $mailHashName + ':-literal-fallback-value}')
    $bad.Add($archiveHmacName + '=' + 'age1' + ('z' * 24))
    $bad.Add($ageIdentityName + '=' + 'AGE-' + 'SECRET-KEY-' + ('A' * 24))
    $bad.Add($rcloneTokenName + '=' + ('rclone-token-' + ('B' * 24)))
    $bad.Add(('step' + '_up') + '=' + 'v1.' + ('C' * 16) + '.' + ('D' * 32))
    $bad.Add(('X-Admin-' + 'Session') + ': ' + ('E' * 32))
    $bad.Add(('ema' + 'il') + ': "reader@example.test"')
    $bad.Add('"' + ('i' + 'p') + '": "192.0.2.1"')
    $bad.Add(('o' + 'tp') + ': "123456"')
    $bad.Add(('to' + 'ken') + ': "opaque"')
    $bad.Add(('bo' + 'dy') + ': "private"')
    $bad.Add(('smtp_original_' + 'response') + ': "provider detail"')
    [System.IO.File]::WriteAllLines($fixture, $bad, $utf8)
    [System.IO.File]::WriteAllText($plaintext, '{}', $utf8)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $distCanary) | Out-Null
    $distSecret = $mailHashName + '="' + ('dist-secret-' + ('F' * 24)) + '"'
    [System.IO.File]::WriteAllText($distCanary, $distSecret, $utf8)

    $blocked = Invoke-Scanner
    $blockedText = $blocked.Output -join "`n"
    Assert-True ($blocked.ExitCode -eq 1) 'dangerous canaries must fail the scanner'
    foreach ($expected in @(
        "literal assignment for $mailHashName",
        "literal assignment for $archiveHmacName",
        'suspected age identity',
        "literal assignment for $rcloneTokenName",
        'suspected admin step-up credential',
        'suspected admin client session',
        'forbidden archive/log field email',
        'forbidden archive/log field ip',
        'forbidden archive/log field otp',
        'forbidden archive/log field token',
        'forbidden archive/log field body',
        'forbidden archive/log field smtp_original_response',
        'archive plaintext artifacts are present',
        "worktree:astro/dist/mail-security-scan-canary.js contains a literal assignment for $mailHashName"
    )) {
        Assert-True ($blockedText.Contains($expected)) "missing expected finding: $expected"
    }

    Remove-Item -LiteralPath $plaintext -Force
    Remove-Item -LiteralPath $distCanary -Force
    $safe = @(
        $mailHashName + '=' + $dollarBrace + $mailHashName + '}',
        $archiveHmacName + '=' + $dollarBrace + $archiveHmacName + ':-}',
        ('MAIL_' + 'INTERNAL_SECRET') + '=REPLACE_WITH_MAIL_INTERNAL_SECRET',
        ('MAIL_ARCHIVE_AGE_' + 'RECIPIENT') + '=age1' + ('q' * 24)
    )
    [System.IO.File]::WriteAllLines($fixture, $safe, $utf8)

    $allowed = Invoke-Scanner
    if ($allowed.ExitCode -ne 0) {
        $safeOutput = $allowed.Output -join [Environment]::NewLine
        throw "SENSITIVE_CHECK_TEST: safe placeholders were rejected`n$safeOutput"
    }
    Write-Host 'PASS sensitive scanner blocks canaries and permits safe placeholders' -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $plaintext -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $distCanary -Force -ErrorAction SilentlyContinue
}
