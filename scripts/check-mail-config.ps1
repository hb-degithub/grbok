#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$issues = [System.Collections.Generic.List[string]]::new()

function Get-ServiceBlock {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$ServiceName
    )

    $escaped = [regex]::Escape($ServiceName)
    $pattern = "(?ms)^  ${escaped}:\s*\r?\n(?<body>.*?)(?=^  [A-Za-z0-9_-]+:\s*(?:\r?\n|$)|^\S|\z)"
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) { return $null }
    return $match.Value
}

function Get-EnvironmentBlock {
    param([Parameter(Mandatory)][string]$ServiceBlock)

    $pattern = '(?ms)^    environment:\s*(?<inline>[^\r\n]*)\r?\n?(?<body>.*?)(?=^    [A-Za-z0-9_-]+:\s*(?:\r?\n|$)|^  [A-Za-z0-9_-]+:|\z)'
    $match = [regex]::Match($ServiceBlock, $pattern)
    if (-not $match.Success) { return $null }
    return $match.Value
}

function Get-EnvironmentNames {
    param([AllowNull()][string]$EnvironmentBlock)

    if ([string]::IsNullOrEmpty($EnvironmentBlock)) { return @() }
    $namePattern = '[A-Z][A-Z0-9_]*'
    $patterns = @(
        ('(?m)^\s+-\s+[''"](?<name>' + $namePattern + ')\s*='),
        ('(?m)^\s+-\s+(?:[''"](?<name>' + $namePattern + ')[''"]|(?<name>' + $namePattern + '))\s*='),
        ('(?m)^\s+(?:[''"](?<name>' + $namePattern + ')[''"]|(?<name>' + $namePattern + '))\s*:')
    )
    $names = [System.Collections.Generic.List[string]]::new()
    foreach ($pattern in $patterns) {
        foreach ($match in [regex]::Matches($EnvironmentBlock, $pattern)) {
            $names.Add($match.Groups['name'].Value)
        }
    }
    return $names
}

function Require-ExactListEntry {
    param(
        [Parameter(Mandatory)][string]$Block,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][string]$Label
    )

    $pattern = "(?m)^\s+-\s+$([regex]::Escape($Name))=$([regex]::Escape($Value))\s*$"
    $count = [regex]::Matches($Block, $pattern).Count
    if ($count -ne 1) {
        $issues.Add("$Label must contain exactly one $Name=$Value entry")
    }
}

function Add-DuplicateEnvironmentIssues {
    param(
        [Parameter(Mandatory)][string]$ComposeName,
        [Parameter(Mandatory)][string]$ServiceName,
        [AllowNull()][string]$EnvironmentBlock
    )

    foreach ($group in @(Get-EnvironmentNames -EnvironmentBlock $EnvironmentBlock) | Group-Object) {
        if ($group.Count -gt 1) {
            $issues.Add("$ComposeName $ServiceName contains duplicate environment key $($group.Name)")
        }
    }
}

$adminExpected = [ordered]@{
    SMTP_HOST = '${SMTP_HOST:-}'
    SMTP_PORT = '${SMTP_PORT:-}'
    SMTP_USERNAME = '${SMTP_USERNAME:-}'
    SMTP_PASSWORD = '${SMTP_PASSWORD:-}'
    SMTP_FROM_ADDRESS = '${SMTP_FROM_ADDRESS:-}'
    SMTP_FROM_NAME = '${SMTP_FROM_NAME:-}'
    SMTP_TLS_MODE = '${SMTP_TLS_MODE:-auto}'
    SMTP_CONNECTION_TIMEOUT_MS = '${SMTP_CONNECTION_TIMEOUT_MS:-10000}'
    SMTP_SOCKET_TIMEOUT_MS = '${SMTP_SOCKET_TIMEOUT_MS:-30000}'
    MAIL_PROVIDER_LABEL = '${MAIL_PROVIDER_LABEL:-Standard SMTP}'
    MAIL_ALERT_RECIPIENTS = '${MAIL_ALERT_RECIPIENTS:-}'
    MAIL_INTERNAL_SECRET = '${MAIL_INTERNAL_SECRET}'
    PUBLIC_SITE_URL = '${PUBLIC_SITE_URL:-https://hlydwz.com}'
    ALIYUN_SMTP_HOST = '${ALIYUN_SMTP_HOST:-}'
    ALIYUN_SMTP_PORT = '${ALIYUN_SMTP_PORT:-}'
    ALIYUN_SMTP_USER = '${ALIYUN_SMTP_USER:-}'
    ALIYUN_SMTP_PASSWORD = '${ALIYUN_SMTP_PASSWORD:-}'
    ALIYUN_FROM_EMAIL = '${ALIYUN_FROM_EMAIL:-}'
    ALIYUN_FROM_NAME = '${ALIYUN_FROM_NAME:-}'
}
$pocketBaseExpected = [ordered]@{
    MAIL_INTERNAL_SECRET = '${MAIL_INTERNAL_SECRET}'
    MAIL_HASH_SECRET = '${MAIL_HASH_SECRET}'
    MAIL_GATEWAY_INTERNAL_URL = 'http://admin-auth:8787'
    MAIL_GATEWAY_ENABLED = '${MAIL_GATEWAY_ENABLED:-false}'
    MAIL_ACCOUNT_ENABLED = '${MAIL_ACCOUNT_ENABLED:-false}'
    MAIL_OTP_ENABLED = '${MAIL_OTP_ENABLED:-false}'
    PUBLIC_SITE_URL = '${PUBLIC_SITE_URL:-https://hlydwz.com}'
}
$pocketBaseOnlyNames = @('MAIL_HASH_SECRET', 'MAIL_GATEWAY_INTERNAL_URL', 'MAIL_GATEWAY_ENABLED', 'MAIL_ACCOUNT_ENABLED', 'MAIL_OTP_ENABLED')

foreach ($composeName in @('docker-compose.yml', 'docker-compose.local.yml')) {
    $composePath = Join-Path $repoRoot $composeName
    if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) {
        $issues.Add("missing $composeName")
        continue
    }

    $text = Get-Content -LiteralPath $composePath -Raw
    $serviceNames = [regex]::Matches($text, '(?m)^  (?<name>[A-Za-z0-9_-]+):\s*$') |
        ForEach-Object { $_.Groups['name'].Value } | Sort-Object -Unique
    $blocks = @{}
    foreach ($serviceName in $serviceNames) {
        $block = Get-ServiceBlock -Text $text -ServiceName $serviceName
        $blocks[$serviceName] = $block
        $environmentBlock = Get-EnvironmentBlock -ServiceBlock $block
        Add-DuplicateEnvironmentIssues -ComposeName $composeName -ServiceName $serviceName -EnvironmentBlock $environmentBlock
        $environmentNames = @(Get-EnvironmentNames -EnvironmentBlock $environmentBlock)
        $inlineEnvironment = [regex]::Match($block, '(?m)^    environment:[\t ]*(?<value>[^\r\n]*)$')
        if ($inlineEnvironment.Success -and $inlineEnvironment.Groups['value'].Value.Trim().Length -gt 0) {
            $issues.Add("$composeName $serviceName must use a multiline environment list")
        }
        if ($block -match '(?m)^    [''"]?env_file[''"]?\s*:') {
            $issues.Add("$composeName $serviceName must not use env_file because its contents cannot be statically isolated")
        }

        if ($environmentBlock -match '(?m)^    environment:\s*[*&]' -or $environmentBlock -match '(?m)^\s+(?:-\s*)?[*&][A-Za-z0-9_-]+' -or $environmentBlock -match '(?m)^\s+[''"]?<<[''"]?\s*:') {
            $issues.Add("$composeName $serviceName must not use YAML aliases or merges for environment")
        }
        if ($serviceName -ne 'admin-auth') {
            foreach ($name in $environmentNames | Where-Object { $_ -match '^(?:SMTP_|ALIYUN_)' }) {
                $issues.Add("$composeName $serviceName contains SMTP or Aliyun variable $name")
            }
        }
        if ($serviceName -ne 'pocketbase') {
            foreach ($name in $environmentNames | Where-Object { $pocketBaseOnlyNames -contains $_ }) {
                $issues.Add("$composeName $serviceName contains PocketBase-only mail variable $name")
            }
        }
        if ($block -match '(?m)^    [''"]?extends[''"]?\s*:' -or $block -match '(?m)^    [''"]?<<[''"]?\s*:') {
            $issues.Add("$composeName $serviceName must not inherit service configuration")
        }
    }

    $adminBlock = $blocks['admin-auth']
    $pocketBaseBlock = $blocks['pocketbase']
    if ($null -eq $adminBlock) {
        $issues.Add("$composeName missing admin-auth service")
    }
    else {
        $adminEnvironmentBlock = Get-EnvironmentBlock -ServiceBlock $adminBlock
        if ($null -eq $adminEnvironmentBlock) {
            $issues.Add("$composeName admin-auth missing environment list")
        }
        else {
            foreach ($entry in $adminExpected.GetEnumerator()) {
                Require-ExactListEntry -Block $adminEnvironmentBlock -Name $entry.Key -Value $entry.Value -Label "$composeName admin-auth"
            }
        }
        if ($adminBlock -match '(?m)^    [''"]?ports[''"]?\s*:') {
            $issues.Add("$composeName admin-auth must not publish ports")
        }
    }

    if ($null -eq $pocketBaseBlock) {
        $issues.Add("$composeName missing pocketbase service")
    }
    else {
        $pocketBaseEnvironmentBlock = Get-EnvironmentBlock -ServiceBlock $pocketBaseBlock
        if ($null -eq $pocketBaseEnvironmentBlock) {
            $issues.Add("$composeName pocketbase missing environment list")
        }
        else {
            foreach ($entry in $pocketBaseExpected.GetEnumerator()) {
                Require-ExactListEntry -Block $pocketBaseEnvironmentBlock -Name $entry.Key -Value $entry.Value -Label "$composeName pocketbase"
            }
        }
    }

    if ($composeName -eq 'docker-compose.yml') {
        $caddyBlock = $blocks['caddy']
        if ($null -eq $caddyBlock -or [regex]::Matches($caddyBlock, '(?m)^\s+-\s+"127\.0\.0\.1:\$\{CADDY_HTTP_PORT:-18080\}:80"\s*$').Count -ne 1) {
            $issues.Add('docker-compose.yml caddy must preserve exactly one localhost port binding')
        }
    }
}

$envPath = Join-Path $repoRoot '.env.example'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    $issues.Add('missing .env.example')
}
else {
    $bytes = [System.IO.File]::ReadAllBytes($envPath)
    try {
        $envText = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    }
    catch {
        $issues.Add('.env.example must be valid UTF-8')
        $envText = ''
    }

    $assignments = [regex]::Matches($envText, '(?m)^(?<name>[A-Z][A-Z0-9_]*)=(?<value>[^\r\n]*)\r?$')
    $groups = $assignments | Group-Object { $_.Groups['name'].Value }
    foreach ($group in $groups) {
        if ($group.Count -gt 1) { $issues.Add(".env.example contains duplicate key $($group.Name)") }
    }
    $values = @{}
    $indices = @{}
    foreach ($assignment in $assignments) {
        $name = $assignment.Groups['name'].Value
        $values[$name] = $assignment.Groups['value'].Value
        $indices[$name] = $assignment.Index
    }

    foreach ($name in @($adminExpected.Keys + $pocketBaseExpected.Keys + @('MAIL_HASH_SECRET')) | Sort-Object -Unique) {
        if (-not $values.ContainsKey($name)) { $issues.Add(".env.example missing $name") }
    }
    foreach ($flag in @('MAIL_GATEWAY_ENABLED', 'MAIL_ACCOUNT_ENABLED', 'MAIL_OTP_ENABLED')) {
        if ($values[$flag] -ne 'false') { $issues.Add(".env.example must set $flag=false") }
    }
    if ($values['MAIL_GATEWAY_INTERNAL_URL'] -ne 'http://admin-auth:8787') {
        $issues.Add('.env.example must use MAIL_GATEWAY_INTERNAL_URL=http://admin-auth:8787')
    }
    if ($values['PUBLIC_SITE_URL'] -ne 'https://hlydwz.com') {
        $issues.Add('.env.example must use PUBLIC_SITE_URL=https://hlydwz.com')
    }
    if ($values['SMTP_PASSWORD'] -ne 'your_smtp_password_here') {
        $issues.Add('.env.example must keep SMTP_PASSWORD=your_smtp_password_here')
    }
    if ($values['ALIYUN_SMTP_PASSWORD'] -ne '') {
        $issues.Add('.env.example must leave ALIYUN_SMTP_PASSWORD empty')
    }
    foreach ($secretName in @('MAIL_INTERNAL_SECRET', 'MAIL_HASH_SECRET')) {
        $secretValue = [string]$values[$secretName]
        if (-not $secretValue.StartsWith('REPLACE_WITH_')) {
            $issues.Add(".env.example must use a REPLACE_WITH_ placeholder for $secretName")
        }
    }
    if ($values['MAIL_INTERNAL_SECRET'] -eq $values['MAIL_HASH_SECRET']) {
        $issues.Add('.env.example must use distinct placeholders for MAIL_INTERNAL_SECRET and MAIL_HASH_SECRET')
    }

    $orderedGroups = @(
        @('SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM_ADDRESS', 'SMTP_FROM_NAME', 'SMTP_TLS_MODE', 'SMTP_CONNECTION_TIMEOUT_MS', 'SMTP_SOCKET_TIMEOUT_MS', 'MAIL_PROVIDER_LABEL', 'MAIL_ALERT_RECIPIENTS'),
        @('ALIYUN_SMTP_HOST', 'ALIYUN_SMTP_PORT', 'ALIYUN_SMTP_USER', 'ALIYUN_SMTP_PASSWORD', 'ALIYUN_FROM_EMAIL', 'ALIYUN_FROM_NAME'),
        @('MAIL_GATEWAY_INTERNAL_URL', 'MAIL_GATEWAY_ENABLED', 'MAIL_ACCOUNT_ENABLED', 'MAIL_OTP_ENABLED'),
        @('MAIL_INTERNAL_SECRET', 'MAIL_HASH_SECRET')
    )
    for ($groupIndex = 0; $groupIndex -lt ($orderedGroups.Count - 1); $groupIndex++) {
        $left = @($orderedGroups[$groupIndex] | Where-Object { $indices.ContainsKey($_) } | ForEach-Object { $indices[$_] })
        $right = @($orderedGroups[$groupIndex + 1] | Where-Object { $indices.ContainsKey($_) } | ForEach-Object { $indices[$_] })
        if ($left.Count -gt 0 -and $right.Count -gt 0 -and (($left | Measure-Object -Maximum).Maximum -ge ($right | Measure-Object -Minimum).Minimum)) {
            $issues.Add('.env.example mail order must be generic SMTP, Aliyun aliases, gateway flags, then mail secrets')
            break
        }
    }

    $mailStart = $envText.IndexOf('# Mail gateway (generic SMTP variables are preferred)')
    $adminSecretIndex = $envText.IndexOf('ADMIN_AUTH_INTERNAL_SECRET=')
    $mailEnd = if ($adminSecretIndex -ge 0) { $envText.LastIndexOf("`n#", $adminSecretIndex) + 1 } else { -1 }
    if ($mailStart -lt 0 -or $mailEnd -le $mailStart) {
        $issues.Add('.env.example mail section boundaries are missing')
    }
    else {
        $mailSection = $envText.Substring($mailStart, $mailEnd - $mailStart)
        if ($mailSection -match '[^\x00-\x7F]') {
            $issues.Add('.env.example mail section must not contain mojibake or non-ASCII text')
        }
    }

    foreach ($secretName in @('SMTP_PASSWORD', 'ALIYUN_SMTP_PASSWORD', 'MAIL_INTERNAL_SECRET', 'MAIL_HASH_SECRET')) {
        if (-not $values.ContainsKey($secretName)) { continue }
        $value = [string]$values[$secretName]
        $placeholder = $value -eq '' -or $value -eq 'your_smtp_password_here' -or $value.StartsWith('REPLACE_WITH_')
        if (-not $placeholder -and $value.Length -ge 16) {
            $issues.Add(".env.example contains a real-looking value for $secretName")
        }
    }
}

if ($issues.Count -gt 0) {
    Write-Host "Mail configuration boundary check failed ($($issues.Count) issues):" -ForegroundColor Red
    $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host 'OK mail configuration boundary is isolated' -ForegroundColor Green
exit 0