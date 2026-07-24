#Requires -Version 5.1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $PSScriptRoot 'pre-deploy-check.ps1'

$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    throw "pre-deploy-check.ps1 has parser errors: $($parseErrors -join '; ')"
}

$requiredFunctions = @('New-Result', 'Invoke-Capture')
$definitions = foreach ($name in $requiredFunctions) {
    $definition = $ast.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if ($null -eq $definition) { throw "missing function in pre-deploy-check.ps1: $name" }
    $definition.Extent.Text
}
Invoke-Expression ($definitions -join [Environment]::NewLine)

$powerShell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$failure = Invoke-Capture $powerShell @(
    '-NoProfile',
    '-Command',
    "[Console]::Error.WriteLine('capture-probe'); exit 23"
) $repoRoot
if ($failure.ExitCode -ne 23) {
    throw "Invoke-Capture lost the child exit code: expected 23, got $($failure.ExitCode)"
}

$success = Invoke-Capture $powerShell @('-NoProfile', '-Command', "Write-Output 'capture-ok'; exit 0") $repoRoot
if ($success.ExitCode -ne 0 -or (@($success.Output) -join "`n") -notmatch 'capture-ok') {
    throw 'Invoke-Capture did not preserve successful output and exit status'
}

Write-Host 'PASS pre-deploy native runner preserves child output and exit codes' -ForegroundColor Green
