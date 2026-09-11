# 生成本地 pb_hooks/pb_migrations 文件 MD5 清单（去 CRLF 口径与服务器一致），并与服务器清单对比
$repo = (Get-Location).Path
$srvManifest = "$env:TEMP\srv_manifest.txt"
$localManifest = "$env:TEMP\local_manifest.txt"

$entries = @()
foreach ($dir in @('pb_hooks', 'pb_migrations')) {
    Get-ChildItem -Path (Join-Path $repo $dir) -Recurse -File -Include *.js, *.pb.js |
        Where-Object { $_.Name -notmatch '\.bak' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($repo.Length + 1).Replace('\', '/')
            $text = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n"
            $bytes = [Text.Encoding]::UTF8.GetBytes($text)
            $ms = New-Object IO.MemoryStream
            $ms.Write($bytes, 0, $bytes.Length)
            $ms.Position = 0
            $hash = (Get-FileHash -InputStream $ms -Algorithm MD5).Hash.ToLower()
            $ms.Dispose()
            $entries += "$hash  $rel"
        }
}
$entries | Sort-Object | Set-Content -Path $localManifest -Encoding ascii

# 对比
$srv = @{}
Get-Content $srvManifest | ForEach-Object {
    if ($_ -match '^([0-9a-f]{32})\s+(.+)$') { $srv[$Matches[2].Trim()] = $Matches[1] }
}
$local = @{}
Get-Content $localManifest | ForEach-Object {
    if ($_ -match '^([0-9a-f]{32})\s+(.+)$') { $local[$Matches[2].Trim()] = $Matches[1] }
}

Write-Output "=== 内容不一致（服务器 vs 本地）==="
foreach ($k in ($srv.Keys | Sort-Object)) {
    if ($local.ContainsKey($k) -and $local[$k] -ne $srv[$k]) {
        Write-Output "DIFF  $k"
    }
}
Write-Output ""
Write-Output "=== 服务器有、本地没有 ==="
foreach ($k in ($srv.Keys | Sort-Object)) {
    if (-not $local.ContainsKey($k)) { Write-Output "SRV-ONLY  $k" }
}
Write-Output ""
Write-Output "=== 本地有、服务器没有（未部署）==="
foreach ($k in ($local.Keys | Sort-Object)) {
    if (-not $srv.ContainsKey($k)) { Write-Output "LOCAL-ONLY  $k" }
}
