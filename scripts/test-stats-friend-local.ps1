#Requires -Version 5.1
param(
    [string]$PocketBasePath = (Join-Path $env:TEMP 'pb-0.22.21-track-a\pocketbase.exe'),
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$repoRoot = Split-Path -Parent $PSScriptRoot
$fixtureSource = Join-Path $repoRoot 'tests\frontend-backend\stats_friend_fixture.pb.js'
$hooksSource = Join-Path $repoRoot 'pb_hooks'
$migrationsSource = Join-Path $repoRoot 'pb_migrations'
$runRoot = Join-Path $env:TEMP ('blog-stats-friend-' + [Guid]::NewGuid().ToString('N'))
$process = $null
$previousMailHashSecret = [Environment]::GetEnvironmentVariable('MAIL_HASH_SECRET', 'Process')
$previousNoProxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'Process')
$previousNoProxyLower = [Environment]::GetEnvironmentVariable('no_proxy', 'Process')

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-FreeTcpPort {
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
    if (-not $resolved.StartsWith($tempRoot + '\blog-stats-friend-', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe stats/friend test root: $resolved"
    }
    return $resolved
}

function Install-PocketBase {
    if (Test-Path -LiteralPath $PocketBasePath -PathType Leaf) { return }
    if ($Offline) { throw "PocketBase binary is unavailable in offline mode: $PocketBasePath" }
    throw "PocketBase binary is unavailable; install the pinned 0.22.21 test binary first: $PocketBasePath"
}

function Invoke-WithNormalizedProcessEnvironment {
    param([Parameter(Mandatory)][scriptblock]$Action)
    $duplicates = [System.Collections.Generic.List[object]]::new()
    $groups = @{}
    foreach ($rawName in [Environment]::GetEnvironmentVariables('Process').Keys) {
        $name = [string]$rawName
        $folded = $name.ToUpperInvariant()
        if (-not $groups.ContainsKey($folded)) {
            $groups[$folded] = [System.Collections.Generic.List[string]]::new()
        }
        $groups[$folded].Add($name)
    }
    try {
        foreach ($group in $groups.Values) {
            if ($group.Count -lt 2) { continue }
            foreach ($name in $group) {
                $duplicates.Add([pscustomobject]@{
                    Name = $name
                    Value = [Environment]::GetEnvironmentVariable($name, 'Process')
                })
                [Environment]::SetEnvironmentVariable($name, $null, 'Process')
            }
            $canonical = @($group | Sort-Object)[0]
            $canonicalValue = @($duplicates | Where-Object { $_.Name -ieq $canonical })[0].Value
            [Environment]::SetEnvironmentVariable($canonical, $canonicalValue, 'Process')
        }
        return & $Action
    }
    finally {
        foreach ($entry in $duplicates) {
            [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process')
        }
        foreach ($entry in $duplicates) {
            [Environment]::SetEnvironmentVariable($entry.Name, $entry.Value, 'Process')
        }
    }
}

function Wait-Ready {
    param([Parameter(Mandatory)][int]$Port)
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) {
            $details = @(
                Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
                Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue
            ) -join [Environment]::NewLine
            throw "PocketBase exited early with code $($process.ExitCode): $details"
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
            if ($response.StatusCode -eq 200) { return }
        } catch {}
        Start-Sleep -Milliseconds 150
    }
    throw 'Timed out waiting for PocketBase'
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory)][Net.Http.HttpClient]$Client,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Url,
        [hashtable]$Headers = @{},
        $Body = $null
    )

    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Url)
    try {
        foreach ($name in $Headers.Keys) {
            [void]$message.Headers.TryAddWithoutValidation($name, [string]$Headers[$name])
        }
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 10 -Compress
            $message.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        }
        $response = $Client.SendAsync($message).GetAwaiter().GetResult()
        try {
            $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            return [pscustomobject]@{
                Status = [int]$response.StatusCode
                Raw = $raw
                Json = if ($raw) { $raw | ConvertFrom-Json } else { $null }
            }
        } finally {
            $response.Dispose()
        }
    } finally {
        $message.Dispose()
    }
}

function Assert-Status {
    param($Response, [int]$Expected, [string]$Label)
    if ($Response.Status -ne $Expected) {
        $serverOutput = @(
            Get-Content -LiteralPath $stdoutPath -Tail 80 -ErrorAction SilentlyContinue
            Get-Content -LiteralPath $stderrPath -Tail 80 -ErrorAction SilentlyContinue
        ) -join [Environment]::NewLine
        throw "$Label expected HTTP $Expected, got $($Response.Status): $($Response.Raw) server=$serverOutput"
    }
}

function Assert-StaticContracts {
    $hookPath = Join-Path $hooksSource 'stats_track.pb.js'
    $libPath = Join-Path $hooksSource 'lib\stats_lib.js'
    $migrationPath = Join-Path $migrationsSource '20260718100000_extend_page_views_friend_target.pb.js'
    $dashboardPath = Join-Path $repoRoot 'astro\src\components\stats\StatsDashboard.tsx'
    $statsServicePath = Join-Path $repoRoot 'astro\src\lib\services\statsService.ts'
    $baseServicePath = Join-Path $repoRoot 'astro\src\lib\services\baseService.ts'
    foreach ($path in @($hookPath, $libPath, $migrationPath, $dashboardPath, $statsServicePath, $baseServicePath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing stats/friend contract file: $path" }
    }

    $hook = Get-Content -Raw -Encoding UTF8 -LiteralPath $hookPath
    if ($hook -notmatch [regex]::Escape("'/api/friend-link-stats'")) { throw 'friend-link-stats route is not registered' }
    if ($hook -match 'visitor_hash\s*=\s*sha256') { throw 'stats hook privacy comment still claims raw sha256' }

    $lib = Get-Content -Raw -Encoding UTF8 -LiteralPath $libPath
    foreach ($marker in @(
        "mailCrypto.hashPrivate('stats-visitor-day'",
        "mailCrypto.hashPrivate('stats-rate-ip'",
        'status = "show" && url = {:target}',
        'INNER JOIN friend_links',
        "range: '30d'",
        '[stats][STATS_TRACK_SAVE_FAILED]',
        '[stats][STATS_QUERY_FAILED]',
        '[stats][FRIEND_STATS_QUERY_FAILED]',
        '[stats][STATS_RETENTION_FAILED]'
    )) {
        if ($lib -notmatch [regex]::Escape($marker)) { throw "Missing stats/friend marker: $marker" }
    }
    if ($lib -match 'X-Forwarded-For|X-Real-IP') { throw 'stats production code must only trust e.realIP()' }
    if ($lib -match "'tv:'\s*\+\s*ip") { throw 'stats rate bucket must not contain raw IP' }
    $logLines = @($lib -split '[\r\n]+' | Where-Object { $_ -match 'console\.error' })
    foreach ($line in $logLines) {
        foreach ($pattern in @(
            '\+\s*(?:error|err)\b',
            '(?:error|err)\.message',
            'JSON\.stringify\((?:error|err)\)',
            'String\((?:error|err)\)',
            '\$\{\s*(?:error|err)\b'
        )) {
            if ($line -match $pattern) { throw "stats logs include exception values: $line" }
        }
    }

    $migration = Get-Content -Raw -Encoding UTF8 -LiteralPath $migrationPath
    foreach ($marker in @('idx_page_views_event_target_created', "name: 'target'", 'max: 500')) {
        if ($migration -notmatch [regex]::Escape($marker)) { throw "Missing target migration marker: $marker" }
    }

    $dashboard = Get-Content -Raw -Encoding UTF8 -LiteralPath $dashboardPath
    if ($dashboard -notmatch [regex]::Escape('useStats')) { throw 'StatsDashboard must load stats via the useStats hook' }
    if ($dashboard -match 'fetch\s*\(' -or $dashboard -match 'const\s+PB_URL') {
        throw 'StatsDashboard must not use raw fetch/PB_URL'
    }

    $statsService = Get-Content -Raw -Encoding UTF8 -LiteralPath $statsServicePath
    if ($statsService -notmatch [regex]::Escape("this.send<StatsData>('/api/blog-stats'")) {
        throw 'statsService must call /api/blog-stats via typed send'
    }

    $baseService = Get-Content -Raw -Encoding UTF8 -LiteralPath $baseServicePath
    foreach ($marker in @('getPocketBase', 'pb.send<R>(path, options)')) {
        if ($baseService -notmatch [regex]::Escape($marker)) { throw "Missing authenticated stats frontend marker: $marker" }
    }
}

$resolvedRunRoot = Assert-SafeRunRoot
Install-PocketBase
if (-not (Test-Path -LiteralPath $fixtureSource -PathType Leaf)) { throw "Missing fixture: $fixtureSource" }

$port = Get-FreeTcpPort
$dataPath = Join-Path $resolvedRunRoot 'pb_data'
$hooksPath = Join-Path $resolvedRunRoot 'pb_hooks'
$libPath = Join-Path $hooksPath 'lib'
$migrationsPath = Join-Path $resolvedRunRoot 'pb_migrations'
New-Item -ItemType Directory -Force -Path $dataPath,$hooksPath,$libPath,$migrationsPath | Out-Null

foreach ($name in @(
    '20260629003000_create_friend_links.pb.js',
    '20260717120000_create_page_views.pb.js',
    '20260718100000_extend_page_views_friend_target.pb.js'
)) {
    $source = Join-Path $migrationsSource $name
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination $migrationsPath -Force
    }
}
Copy-Item -LiteralPath (Join-Path $hooksSource 'stats_track.pb.js') -Destination $hooksPath -Force
Copy-Item -LiteralPath (Join-Path $hooksSource 'lib\stats_lib.js') -Destination $libPath -Force
Copy-Item -LiteralPath (Join-Path $hooksSource 'lib\mail_crypto.js') -Destination $libPath -Force
Copy-Item -LiteralPath (Join-Path $hooksSource 'lib\client_ip.js') -Destination $libPath -Force
Copy-Item -LiteralPath $fixtureSource -Destination (Join-Path $hooksPath 'stats_friend_fixture.pb.js') -Force

[Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', (New-RandomSecret), 'Process')
[Environment]::SetEnvironmentVariable('NO_PROXY', '127.0.0.1,localhost', 'Process')
[Environment]::SetEnvironmentVariable('no_proxy', '127.0.0.1,localhost', 'Process')

$stdoutPath = Join-Path $resolvedRunRoot 'pocketbase.out.log'
$stderrPath = Join-Path $resolvedRunRoot 'pocketbase.err.log'

try {
    $arguments = @(
        'serve',
        "--dir=$dataPath",
        "--migrationsDir=$migrationsPath",
        "--hooksDir=$hooksPath",
        "--http=127.0.0.1:$port",
        '--dev=false'
    )
    $process = Invoke-WithNormalizedProcessEnvironment -Action {
        Start-Process -FilePath $PocketBasePath -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    }
    Wait-Ready -Port $port

    $client = [Net.Http.HttpClient]::new()
    try {
        $baseUrl = "http://127.0.0.1:$port"
        $setup = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/test/stats-friend/setup"
        Assert-Status $setup 200 'fixture setup'
        $showUrl = [string]$setup.Json.showUrl
        $hiddenUrl = [string]$setup.Json.hiddenUrl
        $unknownUrl = [string]$setup.Json.unknownUrl

        $commonHeaders = @{ 'User-Agent' = 'StatsFixtureUA/1.0' }
        $invalidCases = @(
            @{ Label = 'empty target'; Target = ''; Expected = 400 },
            @{ Label = 'javascript target'; Target = 'javascript:alert(1)'; Expected = 400 },
            @{ Label = 'hidden target'; Target = $hiddenUrl; Expected = 400 },
            @{ Label = 'unknown target'; Target = $unknownUrl; Expected = 400 }
        )
        foreach ($case in $invalidCases) {
            $response = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/track-view" -Headers $commonHeaders -Body @{
                path = '/links'
                event = 'link_click'
                target = $case.Target
            }
            Assert-Status $response $case.Expected $case.Label
        }

        $valid = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/track-view" -Headers $commonHeaders -Body @{
            path = '/links'
            event = 'link_click'
            target = $showUrl
        }
        Assert-Status $valid 202 'visible friend target'

        $pageviews = @(
            @{ Path = '/hash-a'; Referrer = '' },
            @{ Path = '/hash-b'; Referrer = '' },
            @{ Path = '/ref-token'; Referrer = 'https://ref.example/path?token=must-not-persist#fragment' },
            @{ Path = '/ref-non-http'; Referrer = 'mailto:test@example.invalid' },
            @{ Path = '/ref-userinfo'; Referrer = 'https://user:pass@ref.example/private' },
            @{ Path = '/ref-control'; Referrer = ('https://ref.example/' + [char]1 + 'bad') }
        )
        foreach ($view in $pageviews) {
            $response = Invoke-JsonRequest -Client $client -Method POST -Url "$baseUrl/api/track-view" -Headers $commonHeaders -Body @{
                path = $view.Path
                event = 'pageview'
                target = $showUrl
                referrer = $view.Referrer
            }
            Assert-Status $response 202 "pageview $($view.Path)"
        }

        $aggregate = Invoke-JsonRequest -Client $client -Method GET -Url "$baseUrl/api/friend-link-stats"
        Assert-Status $aggregate 200 'friend-link aggregate'
        if ([string]$aggregate.Json.range -cne '30d') { throw "Unexpected friend range: $($aggregate.Raw)" }
        if ([string]$aggregate.Json.top[0].target -cne $showUrl -or [int]$aggregate.Json.top[0].clicks -ne 3) {
            throw "Unexpected friend Top 10: $($aggregate.Raw)"
        }
        if ($aggregate.Raw -match 'visitor_hash') { throw 'friend aggregate leaked visitor_hash' }

        $inspect = Invoke-JsonRequest -Client $client -Method GET -Url "$baseUrl/api/test/stats-friend/inspect"
        Assert-Status $inspect 200 'fixture inspect'
        if ([string]$inspect.Json.code -cne 'PASS') { throw "Unexpected fixture result: $($inspect.Raw)" }

        Assert-StaticContracts
        Write-Host 'PASS stats/friend fixture: keyed identity, trusted IP, safe referrer, validated targets and 30-day Top 10' -ForegroundColor Green
    } finally {
        $client.Dispose()
    }
}
finally {
    if ($null -ne $process) {
        try {
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
            $process.WaitForExit()
        } catch {}
        $process.Dispose()
    }
    [Environment]::SetEnvironmentVariable('MAIL_HASH_SECRET', $previousMailHashSecret, 'Process')
    [Environment]::SetEnvironmentVariable('NO_PROXY', $previousNoProxy, 'Process')
    [Environment]::SetEnvironmentVariable('no_proxy', $previousNoProxyLower, 'Process')
    if (Test-Path -LiteralPath $resolvedRunRoot) {
        Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
    }
}
