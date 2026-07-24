#!/usr/bin/env pwsh
param(
    [string]$MailpitPath = 'C:\tmp\mailpit-v1.30.0\mailpit.exe',
    [int]$SmtpPort = 1125,
    [int]$MailpitUiPort = 8125,
    [int]$GatewayPort = 18787
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$adminAuthRoot = Join-Path $repoRoot 'admin-auth'
$integrationTestPath = Join-Path $adminAuthRoot 'test\mail\mailpit.integration.test.mjs'
$runRoot = Join-Path $repoRoot 'tmp\mail-gateway-e2e'
$evidenceRoot = Join-Path $repoRoot 'tmp\mail-evidence'
$evidencePath = Join-Path $evidenceRoot 'gateway.json'
$stopRequestFile = Join-Path $runRoot 'stop-mailpit.request'
$stopAckFile = Join-Path $runRoot 'stop-mailpit.ack'
$mailpitDatabase = Join-Path $runRoot 'mailpit.db'
$mailpitProcess = $null; $gatewayProcess = $null; $integrationProcess = $null; $regressionProcess = $null
$runtimeSecrets = @()
$success = $false
$cleanupCompleted = $false
$secretLeakDetected = $false

function Remove-GatewayEvidence {
    if (Test-Path -LiteralPath $evidencePath -PathType Leaf) {
        Remove-Item -LiteralPath $evidencePath -Force -ErrorAction Stop
    }
}

# Delete stale success evidence before any validation can fail.
Remove-GatewayEvidence

function Assert-TcpPortFree {
    param([Parameter(Mandatory)][int]$Port)
    if ($Port -lt 1 -or $Port -gt 65535) { throw "invalid TCP port: $Port" }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } catch { throw "TCP port $Port is already in use" } finally { $listener.Stop() }
}

function Test-TcpPortOpen {
    param([Parameter(Mandatory)][int]$Port)
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(250)) { return $false }
        $client.EndConnect($async)
        return $client.Connected
    }
    catch { return $false }
    finally { $client.Dispose() }
}

function Wait-TcpPortClosed {
    param([Parameter(Mandatory)][int]$Port, [int]$TimeoutSeconds = 10, [switch]$NoThrow)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Test-TcpPortOpen -Port $Port)) { return $true }
        Start-Sleep -Milliseconds 100
    }
    if ($NoThrow) { return $false }
    throw "TCP port $Port remained open after cleanup"
}

function Wait-HttpReady {
    param([Parameter(Mandatory)][string]$Uri, [Parameter(Mandatory)][object[]]$Processes, [int]$TimeoutSeconds = 30)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        foreach ($managed in $Processes) {
            if ($managed.Process.HasExited) {
                foreach ($line in @(Get-ManagedProcessOutput -Managed $managed)) { Write-Host $line }
                throw "local service process exited before readiness: $($managed.Label) exit=$($managed.Process.ExitCode)"
            }
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 1
            if ($response.StatusCode -eq 200) { return }
        }
        catch {}
        Start-Sleep -Milliseconds 250
    }
    throw "timed out waiting for local endpoint: $Uri"
}

function New-RunSecret {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'))
}

function Get-MinimalBaseEnvironment {
    $values = [ordered]@{}
    foreach ($name in @('SystemRoot', 'WINDIR', 'SystemDrive', 'ComSpec', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'ALLUSERSPROFILE', 'PUBLIC', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN', 'LOGONSERVER', 'OS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'NUMBER_OF_PROCESSORS', 'PSModulePath')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($value)) { $values[$name] = $value }
    }
    return $values
}

function New-IsolatedEnvironment {
    param([Parameter(Mandatory)][hashtable]$Base, [hashtable]$Settings = @{})
    $isolated = [ordered]@{}
    foreach ($entry in $Base.GetEnumerator()) { $isolated[$entry.Key] = [string]$entry.Value }
    foreach ($entry in $Settings.GetEnumerator()) { $isolated[$entry.Key] = [string]$entry.Value }
    return $isolated
}

function Assert-RawOutputHasNoRuntimeSecret {
    param([AllowNull()][AllowEmptyCollection()][object[]]$Records, [Parameter(Mandatory)][string]$Source)
    $matches = 0
    foreach ($line in @($Records)) {
        $text = [string]$line
        foreach ($secret in $runtimeSecrets) {
            if (-not [string]::IsNullOrEmpty($secret) -and $text.Contains($secret)) { $matches++ }
        }
    }
    if ($matches -ne 0) { $script:secretLeakDetected = $true; throw "runtime secret scan failed for $Source ($matches matches)" }
}

function Quote-NativeArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value.Length -eq 0) { return '""' }
    $builder = New-Object Text.StringBuilder
    [void]$builder.Append('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') { [void]$builder.Append(('\' * (($slashes * 2) + 1))); [void]$builder.Append('"'); $slashes = 0; continue }
        if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
        [void]$builder.Append($character)
    }
    if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-WithNormalizedProcessEnvironment {
    param([Parameter(Mandatory)][scriptblock]$Action)
    $duplicates = [System.Collections.Generic.List[object]]::new()
    $groups = @{}
    foreach ($rawName in [Environment]::GetEnvironmentVariables('Process').Keys) {
        $name = [string]$rawName
        $folded = $name.ToUpperInvariant()
        if (-not $groups.ContainsKey($folded)) { $groups[$folded] = [System.Collections.Generic.List[string]]::new() }
        $groups[$folded].Add($name)
    }
    try {
        foreach ($group in $groups.Values) {
            if ($group.Count -lt 2) { continue }
            foreach ($name in $group) {
                $duplicates.Add([pscustomobject]@{ Name = $name; Value = [Environment]::GetEnvironmentVariable($name, 'Process') })
                [Environment]::SetEnvironmentVariable($name, $null, 'Process')
            }
            $canonical = @($group | Sort-Object)[0]
            $canonicalValue = @($duplicates | Where-Object { $_.Name -ieq $canonical })[0].Value
            [Environment]::SetEnvironmentVariable($canonical, $canonicalValue, 'Process')
        }
        return & $Action
    }
    finally {
        foreach ($entry in $duplicates) { [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') }
        foreach ($entry in $duplicates) { [Environment]::SetEnvironmentVariable($entry.Name, $entry.Value, 'Process') }
    }
}

function Start-IsolatedNativeProcess {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$WorkingDirectory, [Parameter(Mandatory)][hashtable]$Environment)
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Executable
    $startInfo.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument -Value ([string]$_) }) -join ' ')
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    # Access EnvironmentVariables while process environment has no case-insensitive duplicates.
    $envSnapshot = @{}
    foreach ($key in [Environment]::GetEnvironmentVariables('Process').Keys) {
        $envSnapshot[[string]$key] = [Environment]::GetEnvironmentVariable([string]$key, 'Process')
    }
    $duplicates = [System.Collections.Generic.List[object]]::new()
    $groups = @{}
    foreach ($rawName in $envSnapshot.Keys) {
        $name = [string]$rawName
        $folded = $name.ToUpperInvariant()
        if (-not $groups.ContainsKey($folded)) { $groups[$folded] = [System.Collections.Generic.List[string]]::new() }
        $groups[$folded].Add($name)
    }
    try {
        foreach ($group in $groups.Values) {
            if ($group.Count -lt 2) { continue }
            foreach ($name in $group) {
                $duplicates.Add([pscustomobject]@{ Name = $name; Value = [Environment]::GetEnvironmentVariable($name, 'Process') })
                [Environment]::SetEnvironmentVariable($name, $null, 'Process')
            }
            $canonical = @($group | Sort-Object)[0]
            $canonicalValue = @($duplicates | Where-Object { $_.Name -ieq $canonical })[0].Value
            [Environment]::SetEnvironmentVariable($canonical, $canonicalValue, 'Process')
        }
        # ProcessStartInfo.EnvironmentVariables can throw or return null when the
        # process environment contains case-insensitive duplicate keys (Path/PATH).
        # After normalization above there should be no duplicates, but the property
        # accessor may still fail on some .NET / PowerShell 5.1 combinations.
        # Use reflection to create a clean StringDictionary and inject it directly.
        $cleanDict = [Collections.Specialized.StringDictionary]::new()
        foreach ($entry in $Environment.GetEnumerator()) { $cleanDict[$entry.Key] = [string]$entry.Value }
        $envField = [Diagnostics.ProcessStartInfo].GetField('environmentVariables', [Reflection.BindingFlags]'Instance,NonPublic')
        if ($null -eq $envField) { throw 'failed to access environmentVariables field via reflection' }
        $envField.SetValue($startInfo, $cleanDict)
    }
    finally {
        foreach ($entry in $duplicates) { [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') }
        foreach ($entry in $duplicates) { [Environment]::SetEnvironmentVariable($entry.Name, $entry.Value, 'Process') }
    }

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "failed to start native process: $Name" }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        return [pscustomobject]@{
            Label = $Name
            Process = $process
            Executable = [IO.Path]::GetFullPath($Executable)
            StartedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
            StdoutTask = $stdoutTask
            StderrTask = $stderrTask
            OutputCollected = $false
            Output = @()
        }
    }
    catch {
        $process.Dispose()
        throw
    }
}

function Assert-ManagedProcessOwned {
    param([Parameter(Mandatory)]$Managed)
    if ($Managed.Process.Id -lt 1) { throw "invalid managed process identity: $($Managed.Label)" }
    $actualStart = $Managed.Process.StartTime.ToUniversalTime().ToString('o')
    if ($actualStart -ne $Managed.StartedAtUtc) {
        throw "managed process ownership verification failed: $($Managed.Label) (start time mismatch)"
    }
    try {
        $modulePath = [string]$Managed.Process.MainModule.FileName
        if ($modulePath.Length -ne 0) {
            $actualPath = [IO.Path]::GetFullPath($modulePath)
            if (-not $actualPath.Equals($Managed.Executable, [StringComparison]::OrdinalIgnoreCase)) {
                throw "managed process ownership verification failed: $($Managed.Label) (path mismatch)"
            }
        }
    } catch {
        # MainModule may be unavailable after process exit; start time check is sufficient
    }
}

function Get-ManagedProcessOutput {
    param([Parameter(Mandatory)]$Managed)
    if (-not $Managed.Process.HasExited) { throw "cannot collect output from running process: $($Managed.Label)" }
    if (-not $Managed.OutputCollected) {
        $lines = [System.Collections.Generic.List[string]]::new()
        foreach ($task in @($Managed.StdoutTask, $Managed.StderrTask)) {
            $text = [string]$task.GetAwaiter().GetResult()
            if ($text.Length -ne 0) {
                foreach ($line in @($text -split '\r?\n')) { if ($line.Length -ne 0) { $lines.Add($line) } }
            }
        }
        Assert-RawOutputHasNoRuntimeSecret -Records @($lines) -Source $Managed.Label
        $Managed.Output = @($lines)
        $Managed.OutputCollected = $true
    }
    return @($Managed.Output)
}

function Wait-ManagedProcessResult {
    param([Parameter(Mandatory)]$Managed, [int]$TimeoutSeconds = 30)
    Assert-ManagedProcessOwned -Managed $Managed
    if (-not $Managed.Process.WaitForExit($TimeoutSeconds * 1000)) { throw "timed out waiting for native process: $($Managed.Label)" }
    $lines = @(Get-ManagedProcessOutput -Managed $Managed)
    if ($Managed.Process.ExitCode -ne 0) { throw "native process failed: $($Managed.Label) exit=$($Managed.Process.ExitCode)" }
    foreach ($line in $lines) { Write-Host $line }
    return $lines
}

function Save-ManagedProcessOutput {
    param([Parameter(Mandatory)]$Managed, [Parameter(Mandatory)][string]$Path)
    $lines = @(Get-ManagedProcessOutput -Managed $Managed)
    [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

function Stop-ManagedProcess {
    param([AllowNull()]$Managed)
    if ($null -eq $Managed) { return @() }
    $errors = [System.Collections.Generic.List[string]]::new()
    try {
        Assert-ManagedProcessOwned -Managed $Managed
        if (-not $Managed.Process.HasExited) {
            $Managed.Process.Kill()
            if (-not $Managed.Process.WaitForExit(5000)) { $errors.Add("native process stop timed out: $($Managed.Label)") }
        }
        if ($Managed.Process.HasExited) { [void](Get-ManagedProcessOutput -Managed $Managed) }
    }
    catch { $errors.Add("native process stop failed for $($Managed.Label): $($_.Exception.Message)") }
    return @($errors)
}

function Dispose-ManagedProcess {
    param([AllowNull()]$Managed)
    if ($null -eq $Managed) { return }
    try { $Managed.Process.Dispose() } catch {}
}

function Invoke-AllCleanup {
    $errors = [System.Collections.Generic.List[string]]::new()
    foreach ($managed in @($integrationProcess, $regressionProcess, $mailpitProcess, $gatewayProcess)) {
        foreach ($errorText in @(Stop-ManagedProcess -Managed $managed)) { $errors.Add($errorText) }
    }
    foreach ($managed in @($integrationProcess, $regressionProcess, $mailpitProcess, $gatewayProcess)) { Dispose-ManagedProcess -Managed $managed }
    foreach ($port in @($SmtpPort, $MailpitUiPort, $GatewayPort)) {
        if (-not (Wait-TcpPortClosed -Port $port -TimeoutSeconds 10 -NoThrow)) { $errors.Add("cleanup failed: TCP port $port is still open") }
    }
    return @($errors)
}

function Wait-StopRequest {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$TestProcess, [int]$TimeoutSeconds = 45)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) { return }
        if ($TestProcess.Process.HasExited) {
            [void](Get-ManagedProcessOutput -Managed $TestProcess)
            throw 'integration test exited before requesting Mailpit shutdown'
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'timed out waiting for integration test Mailpit shutdown request'
}

function Get-ExactSecretFindings {
    param([Parameter(Mandatory)][string[]]$Paths, [Parameter(Mandatory)][string]$Secret)
    $findings = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $items = if (Test-Path -LiteralPath $path -PathType Container) { Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction Stop } else { @(Get-Item -LiteralPath $path -ErrorAction Stop) }
        foreach ($item in $items) {
            $decoded = [Text.UTF8Encoding]::new($false, $false).GetString([IO.File]::ReadAllBytes($item.FullName))
            if ($decoded.Contains($Secret)) { $findings.Add($item.FullName) }
        }
    }
    return @($findings)
}

function Assert-LocalMailpitFile {
    param([Parameter(Mandatory)][string]$Path, [switch]$DefaultPath)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and $item.PSProvider.Name -eq 'FileSystem') { } else { throw 'MailpitPath must be a local filesystem file' }
    $resolved = [IO.Path]::GetFullPath($item.FullName)
    if ($resolved.StartsWith('\\')) { throw 'MailpitPath must be a local filesystem file, not a UNC path' }
    if ([IO.Path]::GetPathRoot($resolved) -notmatch '^[A-Za-z]:\\$') { throw 'MailpitPath must be a local filesystem file' }
    $tempRoot = [IO.Path]::GetFullPath('C:\tmp').TrimEnd('\')
    $underTemp = $resolved.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    if ($DefaultPath -and -not $underTemp) { throw 'the default Mailpit executable must stay below C:\tmp' }
    if ($underTemp) {
        $segments = @('') + @($resolved.Substring($tempRoot.Length).TrimStart('\').Split('\'))
        $current = $tempRoot
        foreach ($segment in $segments) {
            if ($segment.Length -ne 0) { $current = Join-Path $current $segment }
            if (((Get-Item -LiteralPath $current -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Mailpit path contains a reparse point: $current" }
        }
    }
    return $resolved
}

function Assert-MailpitInfo {
    param([Parameter(Mandatory)][int]$Port)
    $info = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/v1/info" -TimeoutSec 2).Content | ConvertFrom-Json
    if ([string]$info.Version -cne 'v1.30.0' -or [string]$info.LatestVersion -cne 'disabled') { throw 'Mailpit info did not match Version=v1.30.0 and LatestVersion=disabled' }
}

$resolvedMailpitPath = Assert-LocalMailpitFile -Path $MailpitPath -DefaultPath:(-not $PSBoundParameters.ContainsKey('MailpitPath'))
if (-not (Test-Path -LiteralPath $integrationTestPath -PathType Leaf)) { throw "integration test not found: $integrationTestPath" }
$nodePath = (Get-Command node -ErrorAction Stop).Source
$gatewayModuleUrl = ([Uri](Join-Path $adminAuthRoot 'src\server.mjs')).AbsoluteUri
$gatewayEval = "import('" + $gatewayModuleUrl + "').then(({ startServer }) => startServer())"
foreach ($port in @($SmtpPort, $MailpitUiPort, $GatewayPort)) { Assert-TcpPortFree -Port $port }
$expectedRunRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'tmp\mail-gateway-e2e'))
$resolvedRunRoot = [IO.Path]::GetFullPath($runRoot)
if (-not $resolvedRunRoot.Equals($expectedRunRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "unsafe run directory: $resolvedRunRoot" }
if (Test-Path -LiteralPath $resolvedRunRoot) { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force -ErrorAction Stop }
New-Item -ItemType Directory -Path $resolvedRunRoot -Force | Out-Null
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null

$mailInternalSecret = New-RunSecret; $adminInternalSecret = New-RunSecret; $adminHashSecret = New-RunSecret
$runtimeSecrets = @($mailInternalSecret, $adminInternalSecret, $adminHashSecret)
$baseEnvironment = Get-MinimalBaseEnvironment
$gatewayEnvironment = New-IsolatedEnvironment -Base $baseEnvironment -Settings ([ordered]@{
    NODE_ENV = 'production'; HOST = '127.0.0.1'; PORT = [string]$GatewayPort
    ADMIN_AUTH_INTERNAL_SECRET = $adminInternalSecret; ADMIN_AUTH_HASH_SECRET = $adminHashSecret; ADMIN_AUTH_RP_ID = 'localhost'; ADMIN_AUTH_ORIGIN = 'http://localhost'
    MAIL_INTERNAL_SECRET = $mailInternalSecret; SMTP_HOST = '127.0.0.1'; SMTP_PORT = [string]$SmtpPort; SMTP_FROM_ADDRESS = 'gateway@example.local'; SMTP_FROM_NAME = 'Mail Gateway Integration'; SMTP_TLS_MODE = 'auto'; SMTP_CONNECTION_TIMEOUT_MS = '1000'; SMTP_SOCKET_TIMEOUT_MS = '3000'
    MAIL_PROVIDER_LABEL = 'Mailpit 1.30.0'; MAIL_LOCAL_TEST_MODE = 'true'; MAIL_TEST_RECIPIENT_ALLOWLIST = 'reader@example.local'; PUBLIC_SITE_URL = 'https://example.local'
})
$integrationEnvironment = New-IsolatedEnvironment -Base $baseEnvironment -Settings ([ordered]@{
    MAILPIT_INTEGRATION = '1'; MAIL_GATEWAY_TEST_URL = "http://127.0.0.1:$GatewayPort"; MAIL_GATEWAY_TEST_PORT = [string]$GatewayPort; MAILPIT_API_URL = "http://127.0.0.1:$MailpitUiPort/api/v1"; MAILPIT_API_PORT = [string]$MailpitUiPort; MAIL_INTERNAL_SECRET = $mailInternalSecret; MAILPIT_STOP_REQUEST_FILE = $stopRequestFile; MAILPIT_STOP_ACK_FILE = $stopAckFile
})
$regressionEnvironment = New-IsolatedEnvironment -Base $baseEnvironment
$mailpitEnvironment = New-IsolatedEnvironment -Base $baseEnvironment

try {
    $mailpitProcess = Start-IsolatedNativeProcess -Name 'mailpit' -Executable $resolvedMailpitPath -Arguments @('--disable-version-check', '--quiet', '--smtp-auth-allow-insecure', '--smtp-disable-rdns', '--block-remote-css-and-fonts', '--database', $mailpitDatabase, '--smtp', "127.0.0.1:$SmtpPort", '--listen', "127.0.0.1:$MailpitUiPort") -WorkingDirectory $resolvedRunRoot -Environment $mailpitEnvironment
    $gatewayProcess = Start-IsolatedNativeProcess -Name 'mail-gateway-node' -Executable $nodePath -Arguments @('--input-type=module', '--eval', $gatewayEval) -WorkingDirectory $adminAuthRoot -Environment $gatewayEnvironment
    Wait-HttpReady -Uri "http://127.0.0.1:$MailpitUiPort/api/v1/info" -Processes @($mailpitProcess, $gatewayProcess)
    Assert-MailpitInfo -Port $MailpitUiPort
    Wait-HttpReady -Uri "http://127.0.0.1:$GatewayPort/health" -Processes @($mailpitProcess, $gatewayProcess)

    $integrationProcess = Start-IsolatedNativeProcess -Name 'mail-gateway-integration-test' -Executable $nodePath -Arguments @('--test', 'test\mail\mailpit.integration.test.mjs') -WorkingDirectory $adminAuthRoot -Environment $integrationEnvironment
    Wait-StopRequest -Path $stopRequestFile -TestProcess $integrationProcess
    $mailpitStopErrors = @(Stop-ManagedProcess -Managed $mailpitProcess)
    if ($mailpitStopErrors.Count -ne 0) { throw ($mailpitStopErrors -join '; ') }
    Save-ManagedProcessOutput -Managed $mailpitProcess -Path (Join-Path $resolvedRunRoot 'mailpit.log')
    Wait-TcpPortClosed -Port $SmtpPort | Out-Null; Wait-TcpPortClosed -Port $MailpitUiPort | Out-Null
    [IO.File]::WriteAllText($stopAckFile, "stopped`n", [Text.UTF8Encoding]::new($false))
    $integrationOutput = Wait-ManagedProcessResult -Managed $integrationProcess -TimeoutSeconds 30
    [IO.File]::WriteAllLines((Join-Path $resolvedRunRoot 'integration.log'), $integrationOutput, [Text.UTF8Encoding]::new($false))

    $gatewayStopErrors = @(Stop-ManagedProcess -Managed $gatewayProcess)
    if ($gatewayStopErrors.Count -ne 0) { throw ($gatewayStopErrors -join '; ') }
    Save-ManagedProcessOutput -Managed $gatewayProcess -Path (Join-Path $resolvedRunRoot 'gateway.log')
    Wait-TcpPortClosed -Port $GatewayPort | Out-Null

    $regressionProcess = Start-IsolatedNativeProcess -Name 'mail-gateway-regression-test' -Executable $nodePath -Arguments @('--test') -WorkingDirectory $adminAuthRoot -Environment $regressionEnvironment
    $regressionOutput = Wait-ManagedProcessResult -Managed $regressionProcess -TimeoutSeconds 60
    [IO.File]::WriteAllLines((Join-Path $resolvedRunRoot 'regression.log'), $regressionOutput, [Text.UTF8Encoding]::new($false))

    $cleanupErrors = @(Invoke-AllCleanup)
    if ($cleanupErrors.Count -ne 0) { throw ($cleanupErrors -join '; ') }
    $cleanupCompleted = $true
    $secretFindings = [System.Collections.Generic.List[string]]::new()
    foreach ($runSecret in $runtimeSecrets) { foreach ($finding in @(Get-ExactSecretFindings -Paths @($resolvedRunRoot) -Secret $runSecret)) { $secretFindings.Add($finding) } }
    if ($secretFindings.Count -ne 0) { $script:secretLeakDetected = $true; Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force -ErrorAction Stop; throw "integration secrets appeared in local artifacts ($($secretFindings.Count) findings)" }
    foreach ($port in @($SmtpPort, $MailpitUiPort, $GatewayPort)) { Wait-TcpPortClosed -Port $port | Out-Null }

    $evidence = [ordered]@{ phase = 'gateway'; nodeTests = 'pass'; mailpitMessages = 1; replayRejected = $true; healthUnaffectedBySmtpFailure = $true; secretFindings = 0 }
    [IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    $evidenceText = [IO.File]::ReadAllText($evidencePath)
    foreach ($runSecret in $runtimeSecrets) { if ($evidenceText.Contains($runSecret)) { $script:secretLeakDetected = $true; throw 'gateway evidence unexpectedly contains an integration secret' } }
    $success = $true
}
finally {
    $finalCleanupErrors = [System.Collections.Generic.List[string]]::new()
    if (-not $cleanupCompleted) {
        foreach ($errorText in @(Invoke-AllCleanup)) { $finalCleanupErrors.Add($errorText) }
    }
    if ($finalCleanupErrors.Count -ne 0) {
        $success = $false
        try { Remove-GatewayEvidence } catch { $finalCleanupErrors.Add('failed to delete gateway evidence after cleanup failure') }
        throw ($finalCleanupErrors -join '; ')
    }
    if ($secretLeakDetected -and (Test-Path -LiteralPath $resolvedRunRoot)) { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force -ErrorAction Stop }
    if (-not $success) { Remove-GatewayEvidence }
}
Write-Host 'PASS mail gateway local integration: signed send, replay rejection, allowlist, verify, health isolation' -ForegroundColor Green