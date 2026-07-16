#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$issues = [System.Collections.Generic.List[string]]::new()

$alwaysFiles = @(
    '.env.example',
    'docker-compose.yml',
    'docker-compose.local.yml',
    'admin-auth/src/config.mjs',
    'admin-auth/src/server.mjs',
    'admin-auth/src/session-policy.mjs',
    'admin-auth/src/step-up-policy.mjs',
    'admin-auth/src/webauthn-service.mjs',
    'pb_hooks/admin_webauthn.pb.js',
    'pb_hooks/admin_security.pb.js',
    'pb_hooks/security_policy_admin.pb.js',
    'scripts/check-mail-config.ps1',
    'scripts/sensitive-check.ps1',
    'scripts/pre-deploy-check.ps1'
)

function Test-RelevantPath {
    param([Parameter(Mandatory)][string]$Path)

    if ($alwaysFiles -contains $Path) { return $true }
    return $Path -match '^admin-auth/src/(?:mail/.*|step-up-policy)\.mjs$' -or
        $Path -match '^pb_hooks/(?:lib/)?(?:admin|security|registration|mail|account_retention).*\.js$' -or
        $Path -match '^ops/' -or
        $Path -match '^scripts/.*(?:mail|archive|security|alert|monitor|deploy).*' -or
        $Path -match '^docs/superpowers/(?:plans|specs)/.*mail.*\.md$' -or
        $Path -match '^\.superpowers/sdd/(?:.*mail.*|gateway-task-.*)\.md$'
}

function Add-HardcodedSecretIssues {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory)][string]$SourceLabel
    )

    if ($Content.Length -eq 0) { return }
    $names = 'ADMIN_AUTH_INTERNAL_SECRET|ADMIN_AUTH_HASH_SECRET|PB_ENCRYPTION_KEY|SMTP_PASSWORD|ALIYUN_SMTP_PASSWORD|MAIL_INTERNAL_SECRET|MAIL_HASH_SECRET|MAIL_ARCHIVE_HMAC_SECRET'
    $prefix = '(?im)(?:^|[\(\[,{;])[\t ]*(?:(?:export)[\t ]+|\$env:|-[\t ]*)?[''"]?(?<name>' + $names + ')[''"]?[\t ]*[:=][\t ]*'
    $valueToken = '(?<value>"(?:\\.|[^"\r\n])*"|''(?:\\.|[^''\r\n])*''|\$\{[^}\r\n]*\}|[^,;#}\r\n]*)'
    $declarationPattern = '(?is)(?:\A|\r?\n)[\t ]*(?:const|let|var)[\t ]+[''"]?(?<name>' + $names + ')[''"]?[\t ]*[:=][\t \r\n]*(?<value>.{0,4096}?)(?:;|(?=\r?\n[\t ]*(?:const|let|var|export|function|class)\b)|\z)'
    $patterns = @(($prefix + $valueToken), $declarationPattern)

    foreach ($pattern in $patterns) {
        foreach ($match in [regex]::Matches($Content, $pattern)) {
            $name = $match.Groups['name'].Value
            $rawValue = $match.Groups['value'].Value.Trim()
            if ($rawValue.Length -ge 2 -and (($rawValue[0] -eq '"' -and $rawValue[$rawValue.Length - 1] -eq '"') -or ($rawValue[0] -eq "'" -and $rawValue[$rawValue.Length - 1] -eq "'"))) {
                $quoted = $true
                $value = $rawValue.Substring(1, $rawValue.Length - 2)
            }
            else {
                $quoted = $false
                $value = $rawValue
            }

            $variableReference = $value -match '^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-)?\}$' -or
                (-not $quoted -and $value -match '^\$[A-Za-z_][A-Za-z0-9_]*$') -or
                (-not $quoted -and $value -match '^\$env:[A-Za-z_][A-Za-z0-9_]*$')
            $sourceReference = -not $quoted -and ($value -match '^(?:process\.env\.|source\.|values\.)[A-Za-z_][A-Za-z0-9_]*$' -or
                $value -match '^getenv\([\t ]*[''"][A-Za-z_][A-Za-z0-9_]*[''"][\t ]*\)$')
            $placeholder = $value -eq '' -or
                $variableReference -or
                $sourceReference -or
                $value.StartsWith('REPLACE_WITH_') -or
                $value -eq 'your_smtp_password_here' -or
                $value -match '^(?:ADMIN_AUTH_INTERNAL_SECRET|ADMIN_AUTH_HASH_SECRET|PB_ENCRYPTION_KEY|SMTP_PASSWORD|ALIYUN_SMTP_PASSWORD|MAIL_INTERNAL_SECRET|MAIL_HASH_SECRET|MAIL_ARCHIVE_HMAC_SECRET)$'
            if (-not $placeholder -and $value.Length -ge 16) {
                $issues.Add("$SourceLabel contains a real-looking literal assignment for $name")
            }
        }
    }
}
function Add-GenericSecretIssues {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory)][string]$SourceLabel,
        [Parameter(Mandatory)][string]$RelativePath
    )

    if ($Content.Length -eq 0 -or $RelativePath -eq 'scripts/sensitive-check.ps1') { return }
    foreach ($entry in @(
        @{ Name = 'private key'; Pattern = 'PRIVATE KEY-----' },
        @{ Name = 'age identity'; Pattern = 'AGE-SECRET-KEY-[A-Z0-9]{20,}' },
        @{ Name = 'admin step-up credential'; Pattern = 'v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{32,}' },
        @{ Name = 'admin client session'; Pattern = 'X-Admin-Session\s*[:=]\s*[A-Za-z0-9_-]{32,}' },
        @{ Name = 'rclone credential'; Pattern = 'RCLONE_CONFIG_[A-Z0-9_]+_(?:TOKEN|PASS|PASSWORD|SECRET)\s*[:=]\s*[A-Za-z0-9_./+=:-]{16,}' },
        @{ Name = 'OpenAI-style token'; Pattern = 'sk-[a-zA-Z0-9]{20,}' },
        @{ Name = 'GitHub token'; Pattern = 'gh[po]_[a-zA-Z0-9]{36}' },
        @{ Name = 'Slack token'; Pattern = 'xox[baprs]-[a-zA-Z0-9-]{10,}' }
    )) {
        if ($Content -match $entry.Pattern) {
            $issues.Add("$SourceLabel contains a suspected $($entry.Name)")
        }
    }
}

function Scan-Content {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory)][string]$SourceLabel,
        [Parameter(Mandatory)][string]$RelativePath
    )

    Add-HardcodedSecretIssues -Content $Content -SourceLabel $SourceLabel
    Add-GenericSecretIssues -Content $Content -SourceLabel $SourceLabel -RelativePath $RelativePath
}

function Get-WorktreeRelevantFiles {
    $files = [System.Collections.Generic.List[string]]::new()
    foreach ($file in $alwaysFiles) { $files.Add($file) }
    foreach ($entry in @(
        @{ Path = 'admin-auth/src/mail'; Filter = '*.mjs'; Recurse = $true },
        @{ Path = 'pb_hooks/lib'; Filter = 'mail*.js'; Recurse = $true },
        @{ Path = 'ops'; Filter = '*'; Recurse = $true },
        @{ Path = 'scripts'; Filter = '*'; Recurse = $false },
        @{ Path = 'docs/superpowers/plans'; Filter = '*mail*.md'; Recurse = $true },
        @{ Path = 'docs/superpowers/specs'; Filter = '*mail*.md'; Recurse = $true },
        @{ Path = '.superpowers/sdd'; Filter = '*mail*.md'; Recurse = $true },
        @{ Path = '.superpowers/sdd'; Filter = 'gateway-task-*.md'; Recurse = $true }
    )) {
        $fullRoot = Join-Path $repoRoot $entry.Path
        if (-not (Test-Path -LiteralPath $fullRoot -PathType Container)) { continue }
        $parameters = @{
            LiteralPath = $fullRoot
            File = $true
            Filter = $entry.Filter
            ErrorAction = 'SilentlyContinue'
        }
        if ($entry.Recurse) { $parameters.Recurse = $true }
        foreach ($item in Get-ChildItem @parameters) {
            $relative = $item.FullName.Substring($repoRoot.Length).TrimStart('\', '/').Replace('\', '/')
            $files.Add($relative)
        }
    }
    return $files | Sort-Object -Unique
}

$untracked = & git -C $repoRoot ls-files --others --exclude-standard 2>$null
$dangerousFiles = $untracked | Where-Object {
    $_ -match '\.(pem|key|ppk)$' -or
    $_ -match '^(id_|.*_ed25519)' -or
    $_ -match '(^|/)\.env$' -or
    $_ -match '\.env\.(local|prod|production)$'
}
if ($dangerousFiles) {
    $issues.Add('untracked sensitive files:')
    $dangerousFiles | ForEach-Object { $issues.Add("  - $_") }
}

$trackedBuildOutput = & git -C $repoRoot ls-files -- 'astro/dist/**' 2>$null
if ($trackedBuildOutput) {
    $issues.Add('astro/dist contains tracked build output')
}

$stagedChangedFiles = @(& git -C $repoRoot diff --cached --name-only --diff-filter=ACMRD 2>$null)
$stagedChangedSet = @{}
foreach ($file in $stagedChangedFiles) { $stagedChangedSet[$file] = $true }

$headFiles = & git -C $repoRoot ls-tree -r --name-only HEAD 2>$null
foreach ($file in $headFiles | Where-Object { (Test-RelevantPath $_) -and -not $stagedChangedSet.ContainsKey($_) }) {
    $content = ((& git -C $repoRoot show "HEAD:$file" 2>$null) -join "`n")
    if ($LASTEXITCODE -eq 0) { Scan-Content -Content $content -SourceLabel "HEAD:$file" -RelativePath $file }
}

$indexFiles = & git -C $repoRoot ls-files --cached 2>$null
$stagedFiles = & git -C $repoRoot diff --cached --name-only --diff-filter=ACMR 2>$null
$indexFilesToScan = @($indexFiles | Where-Object { Test-RelevantPath $_ }) + @($stagedFiles)
foreach ($file in $indexFilesToScan | Sort-Object -Unique) {
    $content = ((& git -C $repoRoot show ":$file" 2>$null) -join "`n")
    if ($LASTEXITCODE -eq 0) { Scan-Content -Content $content -SourceLabel "index:$file" -RelativePath $file }
}

foreach ($file in Get-WorktreeRelevantFiles) {
    $fullPath = Join-Path $repoRoot $file
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
    $content = Get-Content -LiteralPath $fullPath -Raw
    Scan-Content -Content $content -SourceLabel "worktree:$file" -RelativePath $file
}

$recoveryScript = Join-Path $PSScriptRoot 'admin-recovery.ps1'
if (Test-Path -LiteralPath $recoveryScript -PathType Leaf) {
    $recoveryContent = Get-Content -LiteralPath $recoveryScript -Raw
    if ($recoveryContent -match '"[a-f0-9]{32,}"') {
        $issues.Add('admin-recovery.ps1 contains a suspected hardcoded recovery code')
    }
}

if ($issues.Count -gt 0) {
    Write-Host "Sensitive check failed ($($issues.Count) issues):" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    exit 1
}

Write-Host 'OK sensitive check found zero issues' -ForegroundColor Green
exit 0
