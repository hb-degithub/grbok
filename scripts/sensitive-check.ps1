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
    'pb_hooks/lib/mail_archive.js',
    'pb_hooks/lib/mail_logs.js',
    'scripts/check-mail-config.ps1',
    'scripts/check-mail-security-env.ps1',
    'scripts/check-mail-archive-config.ps1',
    'scripts/mail-archive.py',
    'scripts/run-mail-archive-1panel.sh',
    'scripts/verify-mail-archive-restore.py',
    'scripts/sensitive-check.ps1',
    'scripts/pre-deploy-check.ps1',
    'docs/operations/mail-archive-1panel.md'
)

$archiveSchemaFiles = @(
    'pb_hooks/lib/mail_archive.js',
    'pb_hooks/lib/mail_logs.js',
    'scripts/mail-archive.py',
    'scripts/verify-mail-archive-restore.py',
    'scripts/mail-security-leak-fixture.tmp'
)

function Test-TextPath {
    param([Parameter(Mandatory)][string]$Path)
    return $Path -match '(?i)(?:^|/)(?:\.env(?:\.example)?|[^/]+\.(?:conf|env|example|html?|css|js|mjs|cjs|ts|tsx|json|map|xml|md|ps1|py|sh|txt|tmp|ya?ml))$'
}

function Test-RelevantPath {
    param([Parameter(Mandatory)][string]$Path)
    if ($alwaysFiles -contains $Path) { return $true }
    return $Path -match '^admin-auth/src/(?:mail/.*|step-up-policy)\.mjs$' -or
        $Path -match '^pb_hooks/.*\.js$' -or
        $Path -match '^pb_migrations/.*\.js$' -or
        $Path -match '^(?:ops|tests/ops|tests/mail-local|tests/security-rate|tests/admin-security)/' -or
        $Path -match '^scripts/.*(?:mail|archive|security|alert|monitor|deploy).*' -or
        $Path -match '^docs/operations/' -or
        $Path -match '^docs/superpowers/(?:plans|specs)/.*mail.*\.md$' -or
        $Path -match '^\.superpowers/sdd/(?:.*mail.*|gateway-task-.*)\.md$'
}

function Test-FixturePath {
    param([Parameter(Mandatory)][string]$Path)
    return $Path -match '^(?:tests?/|scripts/test-|scripts/.*fixture)'
}

function Test-ArchivePlaintextPath {
    param([Parameter(Mandatory)][string]$Path)
    return $Path -match '(?i)\.(?:jsonl|ndjson)(?:\.gz)?$' -or
        $Path -match '(?i)(?:^|/)[^/]*(?:archive[-_]?plaintext|plaintext[-_]?archive)[^/]*$'
}

function Test-PublicAgeRecipient {
    param([Parameter(Mandatory)][string]$Value)
    # age1 is public; AGE-SECRET-KEY is rejected separately.
    return $Value -match '^(?i)age1[0-9a-z_-]{10,}$'
}

function Add-HardcodedSecretIssues {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory)][string]$SourceLabel,
        [Parameter(Mandatory)][string]$RelativePath
    )

    if ($Content.Length -eq 0) { return }
    $names = 'ADMIN_AUTH_INTERNAL_SECRET|ADMIN_AUTH_HASH_SECRET|PB_ENCRYPTION_KEY|SMTP_PASSWORD|ALIYUN_SMTP_PASSWORD|MAIL_INTERNAL_SECRET|MAIL_HASH_SECRET|MAIL_ARCHIVE_HMAC_SECRET|MAIL_ARCHIVE_AGE_IDENTITY|AGE_IDENTITY|RCLONE_CONFIG_[A-Z0-9_]+_(?:TOKEN|PASS|PASSWORD|SECRET)'
    $unquotedPrefix = '(?im)(?:^|[\(\[,;]|(?<!\$)\{)[\t ]*(?:(?:export)[\t ]+|\$env:|-[\t ]*)?(?<name>(?:' + $names + '))[\t ]*[:=][\t ]*'
    $quotedPrefix = '(?im)(?:^|[\(\[,;]|(?<!\$)\{)[\t ]*(?:(?:export)[\t ]+|\$env:|-[\t ]*)?(?<quote>[''"])(?<name>(?:' + $names + '))\k<quote>[\t ]*[:=][\t ]*'
    $valueToken = '(?<value>"(?:\\.|[^"\r\n])*"|''(?:\\.|[^''\r\n])*''|\$\{[^}\r\n]*\}|[^,;#}\r\n]*)'
    $declarationPattern = '(?is)(?:\A|\r?\n)[\t ]*(?:const|let|var)[\t ]+(?<name>(?:' + $names + '))[\t ]*[:=][\t \r\n]*(?<value>.{0,4096}?)(?:;|(?=\r?\n[\t ]*(?:const|let|var|export|function|class)\b)|\z)'
    $patterns = @(
        ($unquotedPrefix + $valueToken),
        ($quotedPrefix + $valueToken),
        $declarationPattern
    )

    foreach ($pattern in $patterns) {
        foreach ($match in [regex]::Matches($Content, $pattern)) {
            $name = $match.Groups['name'].Value
            $rawValue = $match.Groups['value'].Value.Trim()
            $quoted = $false
            $value = $rawValue
            if ($rawValue.Length -ge 2 -and (($rawValue[0] -eq '"' -and $rawValue[$rawValue.Length - 1] -eq '"') -or ($rawValue[0] -eq "'" -and $rawValue[$rawValue.Length - 1] -eq "'"))) {
                $quoted = $true
                $value = $rawValue.Substring(1, $rawValue.Length - 2)
            }

            $variableReference = $value -match '^\$\{[A-Za-z_][A-Za-z0-9_]*\}$' -or
                $value -match '^\$\{[A-Za-z_][A-Za-z0-9_]*:-\}$' -or
                (-not $quoted -and $value -match '^\$[A-Za-z_][A-Za-z0-9_]*$') -or
                (-not $quoted -and $value -match '^\$env:[A-Za-z_][A-Za-z0-9_]*$')
            $sourceReference = -not $quoted -and ($value -match '^(?:process\.env\.|source\.|values\.)[A-Za-z_][A-Za-z0-9_]*$' -or
                $value -match '^getenv\([\t ]*[''"][A-Za-z_][A-Za-z0-9_]*[''"][\t ]*\)$')
            $secretNameReference = $value -match ('^(?:' + $names + ')$')
            $fixtureValue = (Test-FixturePath $RelativePath) -and
                $value -match '^(?i)(?:fixture|test|local-test)[-_]'
            $placeholder = $value -eq '' -or
                $variableReference -or
                $sourceReference -or
                $secretNameReference -or
                $fixtureValue -or
                $value -match '^(?i)REPLACE[-_]WITH[-_]' -or
                $value -eq 'your_smtp_password_here' -or
                (($RelativePath -match '^docs/') -and $value -eq 'secret')

            if (-not $placeholder -and $value.Length -gt 0) {
                $issues.Add("$SourceLabel contains a literal assignment for $name")
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
        @{ Name = 'private key'; Pattern = '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----' },
        @{ Name = 'age identity'; Pattern = 'AGE-SECRET-KEY-[A-Z0-9-]{20,}' },
        @{ Name = 'admin step-up credential'; Pattern = 'v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{32,}' },
        @{ Name = 'admin client session'; Pattern = 'X-Admin-Session\s*[:=]\s*[A-Za-z0-9_-]{32,}' },
        @{ Name = 'OpenAI-style token'; Pattern = 'sk-[a-zA-Z0-9]{20,}' },
        @{ Name = 'GitHub token'; Pattern = 'gh[po]_[a-zA-Z0-9]{36}' },
        @{ Name = 'Slack token'; Pattern = 'xox[baprs]-[a-zA-Z0-9-]{10,}' }
    )) {
        if ($Content -match $entry.Pattern) { $issues.Add("$SourceLabel contains a suspected $($entry.Name)") }
    }
}

function Add-ArchiveForbiddenFieldIssues {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory)][string]$SourceLabel,
        [Parameter(Mandatory)][string]$RelativePath
    )

    if (-not (($archiveSchemaFiles -contains $RelativePath) -or (Test-ArchivePlaintextPath $RelativePath)) -or $Content.Length -eq 0) { return }
    $forbidden = 'email|masked_email|recipient|recipient_hash|email_hash|ip|ip_hash|source_id|source_record_id|body|html|text|subject|payload|token|otp|code|smtp_response|smtp_original_response|provider_response|user_agent|ua|hostname|free_text|message'
    $patterns = @(
        ('(?i)[''"](?<field>(?:' + $forbidden + '))[''"]\s*:'),
        ('(?im)(?:^|[,{;])[\t ]*(?<field>(?:' + $forbidden + '))[\t ]*:'),
        ('(?i)\.set\(\s*[''"](?<field>(?:' + $forbidden + '))[''"]')
    )

    foreach ($pattern in $patterns) {
        foreach ($match in [regex]::Matches($Content, $pattern)) {
            $issues.Add("$SourceLabel contains forbidden archive/log field $($match.Groups['field'].Value)")
        }
    }
}

function Scan-Content {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory)][string]$SourceLabel,
        [Parameter(Mandatory)][string]$RelativePath
    )
    Add-HardcodedSecretIssues $Content $SourceLabel $RelativePath
    Add-GenericSecretIssues $Content $SourceLabel $RelativePath
    Add-ArchiveForbiddenFieldIssues $Content $SourceLabel $RelativePath
}

function Get-WorktreeRelevantFiles {
    $files = [System.Collections.Generic.List[string]]::new()
    $alwaysFiles | ForEach-Object { $files.Add($_) }
    foreach ($entry in @(
        @{ Path = 'astro/dist'; Filter = '*'; Recurse = $true },
        @{ Path = 'admin-auth/src/mail'; Filter = '*.mjs'; Recurse = $true },
        @{ Path = 'pb_hooks'; Filter = '*.js'; Recurse = $true },
        @{ Path = 'pb_migrations'; Filter = '*.js'; Recurse = $true },
        @{ Path = 'ops'; Filter = '*'; Recurse = $true },
        @{ Path = 'tests/ops'; Filter = '*'; Recurse = $true },
        @{ Path = 'tests/mail-local'; Filter = '*'; Recurse = $true },
        @{ Path = 'tests/security-rate'; Filter = '*'; Recurse = $true },
        @{ Path = 'tests/admin-security'; Filter = '*'; Recurse = $true },
        @{ Path = 'scripts'; Filter = '*'; Recurse = $false },
        @{ Path = 'docs/operations'; Filter = '*.md'; Recurse = $true },
        @{ Path = 'docs/superpowers/plans'; Filter = '*mail*.md'; Recurse = $true },
        @{ Path = 'docs/superpowers/specs'; Filter = '*mail*.md'; Recurse = $true },
        @{ Path = '.superpowers/sdd'; Filter = '*mail*.md'; Recurse = $true },
        @{ Path = '.superpowers/sdd'; Filter = 'gateway-task-*.md'; Recurse = $true }
    )) {
        $fullRoot = Join-Path $repoRoot $entry.Path
        if (-not (Test-Path -LiteralPath $fullRoot -PathType Container)) { continue }
        $parameters = @{ LiteralPath = $fullRoot; File = $true; Filter = $entry.Filter; ErrorAction = 'SilentlyContinue' }
        if ($entry.Recurse) { $parameters.Recurse = $true }
        foreach ($item in Get-ChildItem @parameters) {
            $relative = $item.FullName.Substring($repoRoot.Length).TrimStart('\', '/').Replace('\', '/')
            if (Test-TextPath $relative) { $files.Add($relative) }
        }
    }
    return $files | Sort-Object -Unique
}

function Invoke-GitLines {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = $null
        $output = @(& git -C $repoRoot @Arguments 2>&1)
        $exitCode = $global:LASTEXITCODE
    }
    catch {
        $issues.Add("git command failed: git $($Arguments[0])")
        return @()
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($null -eq $exitCode -or $exitCode -ne 0) {
        $issues.Add("git command failed: git $($Arguments[0]) (exit $exitCode)")
        return @()
    }

    return @($output | Where-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { return $false }
        return ([string]$_) -notmatch '^warning: .*LF will be replaced by CRLF'
    } | ForEach-Object { [string]$_ })
}

$untracked = @(Invoke-GitLines -Arguments @('ls-files', '--others', '--exclude-standard'))
$tracked = @(Invoke-GitLines -Arguments @('ls-files'))
$dangerousFiles = @($tracked + $untracked) | Sort-Object -Unique | Where-Object {
    $_ -match '(?i)\.(?:pem|key|ppk|agekey)$' -or
    $_ -match '(?i)(^|/)(?:id_|.*_ed25519)' -or
    $_ -match '(?i)(^|/)\.env(?:\.(?:local|prod|production))?$' -or
    $_ -match '(?i)(^|/)rclone\.conf$' -or
    $_ -match '(?i)(^|/)mail-archive\.env$' -or
    $_ -match '(?i)(^|/)(?:age[-_]?identity|identity[-_]?age)'
}
if ($dangerousFiles) {
    $issues.Add('sensitive credential/key files are present:')
    $dangerousFiles | ForEach-Object { $issues.Add("  - $_") }
}

$archivePlaintext = @($tracked + $untracked) | Sort-Object -Unique | Where-Object { Test-ArchivePlaintextPath $_ }
if ($archivePlaintext) {
    $issues.Add('archive plaintext artifacts are present:')
    $archivePlaintext | ForEach-Object { $issues.Add("  - $_") }
}

$trackedBuildOutput = @(Invoke-GitLines -Arguments @('ls-files', '--', 'astro/dist/**'))
if ($trackedBuildOutput) { $issues.Add('astro/dist contains tracked build output') }

$stagedChanged = @(Invoke-GitLines -Arguments @('diff', '--cached', '--name-only', '--diff-filter=ACMRD'))
$stagedSet = @{}
$stagedChanged | ForEach-Object { $stagedSet[$_] = $true }

$headFiles = @(Invoke-GitLines -Arguments @('ls-tree', '-r', '--name-only', 'HEAD'))
foreach ($file in $headFiles | Where-Object { (Test-RelevantPath $_) -and -not $stagedSet.ContainsKey($_) }) {
    $content = [string]::Join([Environment]::NewLine, (Invoke-GitLines -Arguments @('show', "HEAD:$file")))
    Scan-Content $content "HEAD:$file" $file
}

$indexFiles = @(Invoke-GitLines -Arguments @('ls-files', '--cached'))
$stagedFiles = @(Invoke-GitLines -Arguments @('diff', '--cached', '--name-only', '--diff-filter=ACMR'))
$indexToScan = @($indexFiles | Where-Object { Test-RelevantPath $_ }) + @($stagedFiles)
foreach ($file in $indexToScan | Sort-Object -Unique) {
    $content = [string]::Join([Environment]::NewLine, (Invoke-GitLines -Arguments @('show', ":$file")))
    Scan-Content $content "index:$file" $file
}

$worktreeChanged = @(Invoke-GitLines -Arguments @('diff', '--name-only', '--diff-filter=ACMR'))
$worktreeToScan = @(Get-WorktreeRelevantFiles) + @($worktreeChanged) + @($untracked)
foreach ($file in $worktreeToScan | Sort-Object -Unique) {
    if (-not (Test-TextPath $file)) { continue }
    $fullPath = Join-Path $repoRoot $file
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
    if ((Get-Item -LiteralPath $fullPath).Length -gt 2MB) {
        $issues.Add("worktree:$file exceeds the 2 MiB sensitive-scan limit")
        continue
    }
    $content = Get-Content -LiteralPath $fullPath -Raw
    Scan-Content $content "worktree:$file" $file
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
