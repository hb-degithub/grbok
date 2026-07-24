#Requires -Version 5.1
param(
    [string]$PocketBasePath = 'C:\tmp\pocketbase-v0.22.21\pocketbase.exe',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$repoRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $env:TEMP ('blog-gallery-' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $runRoot 'pb_data'
$emptyMigrationsRoot = Join-Path $runRoot 'empty_migrations'
$migrationsRoot = Join-Path $runRoot 'pb_migrations'
$hooksRoot = Join-Path $runRoot 'pb_hooks'
$emptyHooksRoot = Join-Path $runRoot 'empty_hooks'
$process = $null
$stdoutPath = ''
$stderrPath = ''
$environmentNames = @('ADMIN_AUTH_HASH_SECRET', 'ADMIN_IP', 'MAIL_HASH_SECRET')
$previousEnvironment = @{}
$originalPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
$originalUpperPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-HmacSha256Hex {
    param([Parameter(Mandatory)][string]$Key, [Parameter(Mandatory)][string]$Value)
    $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Key))
    try {
        return [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant()
    } finally {
        $hmac.Dispose()
    }
}

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function Assert-SafeRunRoot {
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    $resolved = [IO.Path]::GetFullPath($runRoot)
    if (-not $resolved.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe gallery test root: $resolved"
    }
    return $resolved
}

function Wait-PocketBase {
    param([Parameter(Mandatory)][int]$Port)
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) {
            $details = @(
                Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
                Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue
            ) -join [Environment]::NewLine
            throw "PocketBase exited early ($($process.ExitCode)): $details"
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
            if ($response.StatusCode -eq 200) { return }
        } catch {}
        Start-Sleep -Milliseconds 200
    }
    throw 'Timed out waiting for gallery PocketBase fixture'
}

function Start-PocketBase {
    param(
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)][string]$HookDirectory,
        [Parameter(Mandatory)][string]$MigrationDirectory,
        [Parameter(Mandatory)][string]$Label
    )
    $script:stdoutPath = Join-Path $runRoot ($Label + '.out.log')
    $script:stderrPath = Join-Path $runRoot ($Label + '.err.log')
    $arguments = @(
        'serve',
        "--dir=$dataRoot",
        "--migrationsDir=$MigrationDirectory",
        "--hooksDir=$HookDirectory",
        "--http=127.0.0.1:$Port",
        '--dev=false'
    )
    $script:process = Start-Process -FilePath $PocketBasePath -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    Wait-PocketBase -Port $Port
}

function Stop-PocketBase {
    if ($null -eq $process) { return }
    try {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
        $process.WaitForExit()
    } catch {}
    $process.Dispose()
    $script:process = $null
}

function Convert-Response {
    param([Parameter(Mandatory)][Net.Http.HttpResponseMessage]$Response)
    $raw = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $json = $null
    if ($raw) { try { $json = $raw | ConvertFrom-Json } catch {} }
    return [pscustomobject]@{ Status = [int]$Response.StatusCode; Raw = $raw; Json = $json }
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory)][Net.Http.HttpClient]$Client,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Url,
        [string]$Token = '',
        [hashtable]$Headers = @{},
        $Body = $null
    )
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Url)
    try {
        if ($Token) { [void]$message.Headers.TryAddWithoutValidation('Authorization', $Token) }
        foreach ($name in $Headers.Keys) { [void]$message.Headers.TryAddWithoutValidation($name, [string]$Headers[$name]) }
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 12 -Compress
            $message.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        }
        $response = $Client.SendAsync($message).GetAwaiter().GetResult()
        try { return Convert-Response -Response $response } finally { $response.Dispose() }
    } finally {
        $message.Dispose()
    }
}

function Invoke-FileRequest {
    param(
        [Parameter(Mandatory)][Net.Http.HttpClient]$Client,
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string]$ContentType,
        [hashtable]$Fields = @{},
        [string]$Token = '',
        [hashtable]$Headers = @{}
    )
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $Url)
    $multipart = [Net.Http.MultipartFormDataContent]::new('gallery-fixture-' + [Guid]::NewGuid().ToString('N'))
    try {
        if ($Token) { [void]$message.Headers.TryAddWithoutValidation('Authorization', $Token) }
        foreach ($name in $Headers.Keys) { [void]$message.Headers.TryAddWithoutValidation($name, [string]$Headers[$name]) }
        foreach ($name in $Fields.Keys) {
            $fieldContent = [Net.Http.StringContent]::new([string]$Fields[$name], [Text.Encoding]::UTF8)
            $multipart.Add($fieldContent, [string]$name)
        }
        $stream = [IO.File]::OpenRead($FilePath)
        $fileContent = [Net.Http.StreamContent]::new($stream)
        $fileContent.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::Parse($ContentType)
        $multipart.Add($fileContent, 'photo', [IO.Path]::GetFileName($FilePath))
        $message.Content = $multipart
        $response = $Client.SendAsync($message).GetAwaiter().GetResult()
        try { return Convert-Response -Response $response } finally { $response.Dispose() }
    } finally {
        $message.Dispose()
    }
}

function Get-StepUpHeaders {
    param($Actor, [switch]$IncludeCredential)
    $headers = @{ 'User-Agent' = [string]$Actor.userAgent }
    if ($IncludeCredential) {
        $headers['X-Admin-Step-Up'] = [string]$Actor.credential
        $headers['X-Admin-Session'] = [string]$Actor.clientSession
        $headers['X-Browser-Fingerprint'] = [string]$Actor.fingerprint
    }
    return $headers
}

function Assert-Status {
    param([Parameter(Mandatory)][string]$Label, $Response, [Parameter(Mandatory)][int]$Expected)
    if ($Response.Status -ne $Expected) {
        $server = @(
            Get-Content -LiteralPath $stdoutPath -Tail 30 -ErrorAction SilentlyContinue
            Get-Content -LiteralPath $stderrPath -Tail 30 -ErrorAction SilentlyContinue
        ) -join [Environment]::NewLine
        throw "$Label expected HTTP $Expected, got $($Response.Status): $($Response.Raw) server=$server"
    }
}

function Assert-True {
    param([bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

$resolvedRunRoot = Assert-SafeRunRoot
if (-not (Test-Path -LiteralPath $PocketBasePath -PathType Leaf)) {
    if ($Offline) { throw "PocketBase binary is unavailable in offline mode: $PocketBasePath" }
    throw "PocketBase binary is required locally; network download is disabled: $PocketBasePath"
}

$ownedFiles = @(
    'pb_migrations\20260718102000_create_gallery_items.pb.js',
    'pb_hooks\gallery_defaults.pb.js',
    'pb_hooks\lib\admin_step_up.js',
    'pb_hooks\audit_admin_actions.pb.js',
    'tests\frontend-backend\gallery_security_fixture.pb.js'
)
foreach ($relative in $ownedFiles) {
    $full = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Track P required file missing: $relative" }
}

$migrationSource = [IO.File]::ReadAllText((Join-Path $repoRoot 'pb_migrations\20260718102000_create_gallery_items.pb.js'))
foreach ($marker in @('gallery_items', '10485760', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', '300x300', 'sort_order', 'status = "show"')) {
    Assert-True ($migrationSource.Contains($marker)) "Gallery migration missing contract marker: $marker"
}
Assert-True (-not $migrationSource.Contains('image/svg+xml')) 'Gallery migration must reject SVG uploads'

$stepUpSource = [IO.File]::ReadAllText((Join-Path $repoRoot 'pb_hooks\lib\admin_step_up.js'))
Assert-True (([regex]::Matches($stepUpSource, "'guestbook_messages'")).Count -eq 1) 'guestbook_messages must appear exactly once in the generic protected collection list'
Assert-True (([regex]::Matches($stepUpSource, "'gallery_items'")).Count -eq 1) 'gallery_items must appear exactly once in the generic protected collection list'
foreach ($marker in @('ADMIN_MANAGED_COLLECTIONS', 'function actingPrincipal', 'function auditManagedWrite', 'pb_admin:', 'admin-audit-actor:')) {
    Assert-True ($stepUpSource.Contains($marker)) "Audit security library missing contract marker: $marker"
}

$auditSource = [IO.File]::ReadAllText((Join-Path $repoRoot 'pb_hooks\audit_admin_actions.pb.js'))
foreach ($marker in @("auditManagedWrite(e, 'create')", "auditManagedWrite(e, 'update')", "auditManagedWrite(e, 'delete')", '[audit-write-failed] operation=write result=INTERNAL_ERROR')) {
    Assert-True ($auditSource.Contains($marker)) "Audit hook missing callback marker: $marker"
}
Assert-True (-not [regex]::IsMatch($auditSource, '(?s)(?:error|err)\.message|String\s*\(\s*(?:error|err)\b|JSON\.stringify\s*\(\s*(?:error|err)\b|\$\{\s*(?:error|err)\s*\}|\+\s*(?:error|err)\b')) 'Audit hook must not log raw exception data'

Assert-True (-not $auditSource.Contains("=> logEvent")) 'Audit callbacks must not reference an outer runtime closure'
Assert-True (-not [regex]::IsMatch($stepUpSource, '(?s)(?:error|err)\.message|String\s*\(\s*(?:error|err)\b|JSON\.stringify\s*\(\s*(?:error|err)\b|\$\{\s*(?:error|err)\s*\}|\+\s*(?:error|err)\b')) 'Audit security library must not log raw exception data'
$normalizedPath = $originalPath
if ([string]::IsNullOrWhiteSpace($normalizedPath)) { $normalizedPath = $originalUpperPath }
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $normalizedPath, 'Process')
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$hashSecret = New-RandomSecret
[Environment]::SetEnvironmentVariable('ADMIN_AUTH_HASH_SECRET', $hashSecret, 'Process')
[Environment]::SetEnvironmentVariable('ADMIN_IP', '127.0.0.1', 'Process')
[Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', (New-RandomSecret), 'Process')

try {
    New-Item -ItemType Directory -Force -Path $dataRoot,$migrationsRoot,$emptyMigrationsRoot,$hooksRoot,$emptyHooksRoot | Out-Null
    Copy-Item -Path (Join-Path $repoRoot 'pb_migrations\*.pb.js') -Destination $migrationsRoot -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'pb_hooks\require_verified_session.pb.js') -Destination $hooksRoot -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'pb_hooks\audit_admin_actions.pb.js') -Destination $hooksRoot -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'pb_hooks\gallery_defaults.pb.js') -Destination $hooksRoot -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'pb_hooks\lib') -Destination $hooksRoot -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'tests\frontend-backend\gallery_security_fixture.pb.js') -Destination (Join-Path $hooksRoot 'gallery_security_fixture.pb.js') -Force

    $pngPath = Join-Path $runRoot 'gallery-photo-name-canary.png'
    $svgPath = Join-Path $runRoot 'gallery-rejected.svg'
    $oversizePath = Join-Path $runRoot 'gallery-oversize.png'
    $pngBytes = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
    [IO.File]::WriteAllBytes($pngPath, $pngBytes)
    [IO.File]::WriteAllText($svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', [Text.UTF8Encoding]::new($false))
    $oversize = [IO.File]::Create($oversizePath)
    try {
        $oversize.Write($pngBytes, 0, $pngBytes.Length)
        $oversize.SetLength(10485761)
    } finally {
        $oversize.Dispose()
    }

    $port = Get-FreePort
    Start-PocketBase -Port $port -HookDirectory $emptyHooksRoot -MigrationDirectory $emptyMigrationsRoot -Label 'bootstrap'
    Stop-PocketBase

    $adminEmail = 'gallery-pb-admin@example.local'
    $adminPassword = 'GalleryAdmin-' + (New-RandomSecret)
    & $PocketBasePath admin create $adminEmail $adminPassword "--dir=$dataRoot" '--dev=false' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create local PocketBase admin' }

    Start-PocketBase -Port $port -HookDirectory $hooksRoot -MigrationDirectory $migrationsRoot -Label 'gallery'
    $baseUrl = "http://127.0.0.1:$port"
    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    try {
        $setup = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/gallery/setup"
        Assert-Status 'gallery setup' $setup 200
        $author = $setup.Json.author
        $unverified = $setup.Json.unverified
        $superAdmin = $setup.Json.superAdmin
        $authorHeaders = Get-StepUpHeaders -Actor $author -IncludeCredential
        $unverifiedHeaders = Get-StepUpHeaders -Actor $unverified -IncludeCredential
        $superHeaders = Get-StepUpHeaders -Actor $superAdmin -IncludeCredential
        $bindingProbe = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/gallery/binding-probe" -Token ([string]$author.token) -Headers $authorHeaders
        Assert-Status 'author step-up binding probe' $bindingProbe 200
        $bindingChecks = @('actor', 'verified', 'shape', 'row', 'matchesUser', 'matchesSecret', 'matchesSession', 'matchesFingerprint', 'matchesIp', 'matchesUserAgent', 'hasIp', 'hasUserAgent')
        foreach ($check in $bindingChecks) {
            if (-not [bool]$bindingProbe.Json.$check) { throw "author step-up binding mismatch at ${check}: $($bindingProbe.Raw)" }
        }
        Assert-True ([string]$bindingProbe.Json.role -ceq 'author') "author step-up binding role mismatch: $($bindingProbe.Raw)"


        $collectionUrl = "$baseUrl/api/collections/gallery_items/records"
        $anonymous = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $pngPath -ContentType 'image/png' -Fields @{ title = 'Anonymous'; status = 'show' } -Headers @{ 'User-Agent' = 'gallery-anonymous-agent' }
        Assert-True ($anonymous.Status -ge 400 -and $anonymous.Status -lt 500) "anonymous gallery create unexpectedly escaped RBAC: $($anonymous.Raw)"

        $withoutStepUp = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $pngPath -ContentType 'image/png' -Fields @{ title = 'No step-up'; status = 'show' } -Token ([string]$author.token) -Headers (Get-StepUpHeaders -Actor $author)
        Assert-Status 'author create without step-up' $withoutStepUp 403

        $unverifiedCreate = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $pngPath -ContentType 'image/png' -Fields @{ title = 'Unverified'; status = 'show' } -Token ([string]$unverified.token) -Headers $unverifiedHeaders
        Assert-Status 'unverified author create with step-up' $unverifiedCreate 403

        $svgUpload = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $svgPath -ContentType 'image/svg+xml' -Fields @{ title = 'SVG'; status = 'show' } -Token ([string]$author.token) -Headers $authorHeaders
        Assert-True ($svgUpload.Status -ge 400) "SVG upload unexpectedly succeeded: $($svgUpload.Raw)"

        $oversizeUpload = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $oversizePath -ContentType 'image/png' -Fields @{ title = 'Oversize'; status = 'show' } -Token ([string]$author.token) -Headers $authorHeaders
        Assert-True ($oversizeUpload.Status -ge 400) "Oversize upload unexpectedly succeeded: $($oversizeUpload.Raw)"

        $descriptionCanary = 'gallery-description-canary-' + [Guid]::NewGuid().ToString('N')
        $updatedDescriptionCanary = 'gallery-updated-description-canary-' + [Guid]::NewGuid().ToString('N')
        $created = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $pngPath -ContentType 'image/png' -Fields @{ title = '  Gallery Title  '; description = $descriptionCanary; album = '  Album  '; status = 'show' } -Token ([string]$author.token) -Headers $authorHeaders
        $multipartProbe = Invoke-JsonRequest -Client $client -Method GET -Url "$baseUrl/api/test/gallery/multipart-binding-probe"
        Assert-Status 'multipart binding probe' $multipartProbe 200
        if ($created.Status -ne 200) {
            throw "author create with step-up expected HTTP 200, got $($created.Status): $($created.Raw) binding=$($multipartProbe.Raw)"
        }
        Assert-True ([string]$created.Json.title -ceq 'Gallery Title') 'gallery title was not trimmed'
        Assert-True ([string]$created.Json.album -ceq 'Album') 'gallery album was not trimmed'
        Assert-True ([string]$created.Json.status -ceq 'show') 'gallery status did not default to show'
        $galleryId = [string]$created.Json.id
        Start-Sleep -Milliseconds 25

        $hidden = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $pngPath -ContentType 'image/png' -Fields @{ title = 'Hidden'; status = 'hidden' } -Token ([string]$author.token) -Headers $authorHeaders
        Assert-Status 'author hidden create with step-up' $hidden 200

        $publicList = Invoke-JsonRequest -Client $client -Method GET -Url ($collectionUrl + '?perPage=50')
        Assert-Status 'public gallery list' $publicList 200
        $publicItems = @($publicList.Json.items)
        $publicShow = @($publicItems | Where-Object { [string]$_.status -ceq 'show' }).Count
        $publicHidden = @($publicItems | Where-Object { [string]$_.status -ceq 'hidden' }).Count
        Assert-True ($publicShow -eq 1) "public show list count expected 1, got $publicShow"
        Assert-True ($publicHidden -eq 0) "public hidden list count expected 0, got $publicHidden"

        $updated = Invoke-JsonRequest -Client $client -Method PATCH -Url ($collectionUrl + '/' + $galleryId) -Token ([string]$author.token) -Headers $authorHeaders -Body @{ title = 'Updated Gallery'; description = $updatedDescriptionCanary }
        Assert-Status 'author update with step-up' $updated 200
        Start-Sleep -Milliseconds 25

        $authorDelete = Invoke-JsonRequest -Client $client -Method DELETE -Url ($collectionUrl + '/' + $galleryId) -Token ([string]$author.token) -Headers $authorHeaders
        Assert-Status 'author delete with step-up' $authorDelete 404

        $superDeleteWithout = Invoke-JsonRequest -Client $client -Method DELETE -Url ($collectionUrl + '/' + $galleryId) -Token ([string]$superAdmin.token) -Headers (Get-StepUpHeaders -Actor $superAdmin)
        Assert-Status 'super admin delete without step-up' $superDeleteWithout 403

        $superDelete = Invoke-JsonRequest -Client $client -Method DELETE -Url ($collectionUrl + '/' + $galleryId) -Token ([string]$superAdmin.token) -Headers $superHeaders
        Assert-Status 'super admin delete with step-up' $superDelete 204
        Start-Sleep -Milliseconds 25

        $guestbookUrl = "$baseUrl/api/collections/guestbook_messages/records/$([string]$setup.Json.guestbookId)"
        $guestbookWithout = Invoke-JsonRequest -Client $client -Method PATCH -Url $guestbookUrl -Token ([string]$superAdmin.token) -Headers (Get-StepUpHeaders -Actor $superAdmin) -Body @{ status = 'hidden' }
        Assert-Status 'guestbook update without step-up' $guestbookWithout 403

        $guestbookUpdatedContent = 'guestbook-updated-content-canary-' + [Guid]::NewGuid().ToString('N')
        $guestbookUpdate = Invoke-JsonRequest -Client $client -Method PATCH -Url $guestbookUrl -Token ([string]$superAdmin.token) -Headers $superHeaders -Body @{ status = 'hidden'; content = $guestbookUpdatedContent }
        Assert-Status 'guestbook update with step-up' $guestbookUpdate 200
        Start-Sleep -Milliseconds 25

        $guestbookDeleteWithout = Invoke-JsonRequest -Client $client -Method DELETE -Url $guestbookUrl -Token ([string]$superAdmin.token) -Headers (Get-StepUpHeaders -Actor $superAdmin)
        Assert-Status 'guestbook delete without step-up' $guestbookDeleteWithout 403

        $guestbookDelete = Invoke-JsonRequest -Client $client -Method DELETE -Url $guestbookUrl -Token ([string]$superAdmin.token) -Headers $superHeaders
        Assert-Status 'guestbook delete with step-up' $guestbookDelete 204

        $adminAuth = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/admins/auth-with-password" -Body @{ identity = $adminEmail; password = $adminPassword }
        Assert-Status 'PocketBase admin auth' $adminAuth 200
        $pbAdminToken = [string]$adminAuth.Json.token
        $pbAdminId = [string]$adminAuth.Json.admin.id
        $pbAdminCreate = Invoke-FileRequest -Client $client -Url $collectionUrl -FilePath $pngPath -ContentType 'image/png' -Fields @{ title = 'PB Admin Gallery'; description = 'pb-admin-description-canary'; status = 'show' } -Token $pbAdminToken -Headers @{ 'User-Agent' = 'gallery-pb-admin-agent' }
        Assert-Status 'PocketBase admin create without application step-up' $pbAdminCreate 200
        $pbAdminGalleryId = [string]$pbAdminCreate.Json.id

        $audits = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/gallery/audits" -Body @{ galleryId = $galleryId; guestbookId = [string]$setup.Json.guestbookId; pbAdminGalleryId = $pbAdminGalleryId }
        Assert-Status 'gallery audit query' $audits 200
        $auditActions = @($audits.Json.gallery | ForEach-Object { [string]$_.action })
        Assert-True (($auditActions -join ',') -ceq 'create_gallery_items,update_gallery_items,delete_gallery_items') "gallery audit actions mismatch: $($auditActions -join ',')"

        $galleryAuditText = $audits.Json.gallery | ConvertTo-Json -Depth 10 -Compress
        foreach ($secretValue in @([IO.Path]::GetFileName($pngPath), $descriptionCanary, $updatedDescriptionCanary, '127.0.0.1', [string]$author.credential)) {
            Assert-True (-not $galleryAuditText.Contains($secretValue)) "gallery audit exposed protected value: $secretValue"
        }
        $guestbookAuditText = $audits.Json.guestbook | ConvertTo-Json -Depth 10 -Compress
        foreach ($secretValue in @([string]$setup.Json.guestbookNickname, [string]$setup.Json.guestbookContent, $guestbookUpdatedContent)) {
            Assert-True (-not $guestbookAuditText.Contains($secretValue)) "guestbook audit exposed message data: $secretValue"
        }

        $pbAdminRows = @($audits.Json.pbAdmin)
        Assert-True ($pbAdminRows.Count -eq 1) "PocketBase admin audit row count mismatch: $($pbAdminRows.Count)"
        $expectedPbAdminActor = 'pb_admin:' + (Get-HmacSha256Hex -Key $hashSecret -Value ('admin-audit-actor:' + $pbAdminId))
        Assert-True ([string]$pbAdminRows[0].actor -ceq $expectedPbAdminActor) "PocketBase admin audit actor mismatch: $([string]$pbAdminRows[0].actor)"
        Assert-True ([string]$pbAdminRows[0].actor -match '^pb_admin:[a-f0-9]{64}$') 'PocketBase admin audit actor is not a stable HMAC pseudonym'

        Write-Host ('PASS gallery security fixture: ' + (@{
            publicShowListCount = $publicShow
            publicHiddenListCount = $publicHidden
            anonymousCreateStatus = $anonymous.Status
            authorCreateWithoutStepUpStatus = $withoutStepUp.Status
            unverifiedAuthorCreateWithStepUpStatus = $unverifiedCreate.Status
            authorCreateWithStepUpStatus = $created.Status
            authorUpdateWithStepUpStatus = $updated.Status
            authorDeleteWithStepUpStatus = $authorDelete.Status
            superAdminDeleteWithoutStepUpStatus = $superDeleteWithout.Status
            superAdminDeleteWithStepUpStatus = $superDelete.Status
            svgUploadStatus = $svgUpload.Status
            oversizeUploadStatus = $oversizeUpload.Status
            guestbookUpdateWithoutStepUpStatus = $guestbookWithout.Status
            guestbookUpdateWithStepUpStatus = $guestbookUpdate.Status
            guestbookDeleteWithoutStepUpStatus = $guestbookDeleteWithout.Status
            guestbookDeleteWithStepUpStatus = $guestbookDelete.Status
            pbAdminCreateWithoutApplicationStepUpStatus = $pbAdminCreate.Status
        } | ConvertTo-Json -Compress)) -ForegroundColor Green
    } finally {
        $client.Dispose()
    }
} finally {
    Stop-PocketBase
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
    [Environment]::SetEnvironmentVariable('PATH', $originalUpperPath, 'Process')
    [Environment]::SetEnvironmentVariable('Path', $originalPath, 'Process')
    if (Test-Path -LiteralPath $resolvedRunRoot) { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force }
}
