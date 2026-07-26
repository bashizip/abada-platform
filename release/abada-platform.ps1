param(
  [ValidateSet("doctor", "up", "down", "status", "logs")]
  [string]$Command = "doctor",
  [ValidateSet("dev", "prod")]
  [string]$Profile = "dev",
  [switch]$Telemetry,
  [string]$EnvFile,
  [switch]$NoPull
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $Root ".env.$Profile" }
if ($Profile -eq "dev" -and -not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $PSScriptRoot ".env.dev.example") $EnvFile
  Write-Host "Created $EnvFile from the safe development defaults."
}
if (-not (Test-Path $EnvFile)) {
  throw "Environment file not found: $EnvFile"
}

$Compose = @("compose", "--env-file", $EnvFile, "-f", (Join-Path $Root "compose.yaml"), "-f", (Join-Path $Root "compose.$Profile.yaml"))
if ($Telemetry) { $Compose += @("-f", (Join-Path $Root "compose.telemetry.yaml")) }

function Invoke-Compose([string[]]$Arguments) {
  & docker @Compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
}

function Get-EnvValue([string]$Name) {
  $Line = Get-Content $EnvFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $Line) { return "" }
  return $Line.Substring($Line.IndexOf('=') + 1)
}

function Enable-Rc1Arm64Compatibility {
  $DockerArchitecture = (& docker info --format '{{.Architecture}}').Trim()
  if (@('arm64', 'aarch64') -notcontains $DockerArchitecture) { return }

  $Version = Get-EnvValue 'ABADA_VERSION'
  $EngineImage = Get-EnvValue 'ABADA_ENGINE_IMAGE'
  $TendaImage = Get-EnvValue 'ABADA_TENDA_IMAGE'
  $OrunImage = Get-EnvValue 'ABADA_ORUN_IMAGE'
  $UsesRc1Images = $Version -eq '1.0.0-rc.1' -or (
    $EngineImage.EndsWith(':1.0.0-rc.1') -and
    $TendaImage.EndsWith(':1.0.0-rc.1') -and
    $OrunImage.EndsWith(':1.0.0-rc.1')
  )
  if ($UsesRc1Images -and -not $env:DOCKER_DEFAULT_PLATFORM) {
    $env:DOCKER_DEFAULT_PLATFORM = 'linux/amd64'
    Write-Warning 'Abada 1.0.0-rc.1 images are amd64-only; Docker compatibility mode is enabled on this ARM host.'
  }
}

function Assert-Hostname([string]$Name, [string]$Value) {
  if ($Value -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$' -or
      $Value -notmatch '\.' -or $Value -match '\.\.|://|/' -or
      $Value -eq 'localhost' -or $Value.EndsWith('.localhost')) {
    throw "$Name must be a DNS hostname without a scheme or path"
  }
}

function Assert-HttpsUrl([string]$Name, [string]$Value) {
  $Parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$Parsed) -or
      $Parsed.Scheme -ne 'https' -or -not $Parsed.Host -or $Value.Contains('*')) {
    throw "$Name must be an HTTPS URL without wildcards"
  }
}

function Assert-ProductionValues {
  $Values = Get-Content $EnvFile | Where-Object {
    $_ -notmatch '^\s*#' -and $_ -notmatch '^GRAFANA_ADMIN_PASSWORD='
  }
  if (($Values -join "`n") -match 'change-me|example\.com') {
    throw "Production environment still contains placeholders"
  }

  $Password = Get-EnvValue 'POSTGRES_PASSWORD'
  $Version = Get-EnvValue 'ABADA_VERSION'
  $ApiHost = Get-EnvValue 'ABADA_API_HOST'
  $TasksHost = Get-EnvValue 'ABADA_TASKS_HOST'
  $OpsHost = Get-EnvValue 'ABADA_OPS_HOST'
  if ($Password.Length -lt 16) { throw 'POSTGRES_PASSWORD must contain at least 16 characters' }
  if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$' -or $Version -eq 'latest') {
    throw 'ABADA_VERSION must be an exact immutable semantic version'
  }
  Assert-Hostname 'ABADA_API_HOST' $ApiHost
  Assert-Hostname 'ABADA_TASKS_HOST' $TasksHost
  Assert-Hostname 'ABADA_OPS_HOST' $OpsHost
  if ((@($ApiHost, $TasksHost, $OpsHost) | Sort-Object -Unique).Count -ne 3) {
    throw 'API, task and operations hostnames must be distinct'
  }
  if ((Get-EnvValue 'ABADA_ACME_EMAIL') -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
    throw 'ABADA_ACME_EMAIL must be a valid email address'
  }
  Assert-HttpsUrl 'OIDC_ISSUER_URI' (Get-EnvValue 'OIDC_ISSUER_URI')
  if ((Get-EnvValue 'OIDC_AUDIENCE') -notmatch '^[A-Za-z0-9._:/-]+$') {
    throw 'OIDC_AUDIENCE must be a non-empty audience identifier'
  }
  Assert-HttpsUrl 'ABADA_OIDC_URL' (Get-EnvValue 'ABADA_OIDC_URL')
  foreach ($Origin in (Get-EnvValue 'ABADA_ALLOWED_ORIGINS').Split(',')) {
    if ($Origin -notmatch '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]+)?$' -or $Origin.Contains('*')) {
      throw 'Every production CORS origin must be an exact HTTPS origin'
    }
  }

  if ($Telemetry) {
    $GrafanaPassword = Get-EnvValue 'GRAFANA_ADMIN_PASSWORD'
    if ($GrafanaPassword.Length -lt 16 -or $GrafanaPassword -match 'change-me') {
      throw 'Telemetry requires a non-placeholder GRAFANA_ADMIN_PASSWORD with at least 16 characters'
    }
  }
}

function Assert-TelemetryValues {
  $TelemetryEnabled = Get-EnvValue 'ABADA_TELEMETRY_ENABLED'
  if (@('true', 'false') -notcontains $TelemetryEnabled) {
    throw 'ABADA_TELEMETRY_ENABLED must be true or false'
  }
  if (-not $Telemetry -and $TelemetryEnabled -eq 'true') {
    $Endpoint = Get-EnvValue 'ABADA_TELEMETRY_OTLP_ENDPOINT'
    $ParsedEndpoint = $null
    if (-not [Uri]::TryCreate($Endpoint, [UriKind]::Absolute, [ref]$ParsedEndpoint) -or
        @('http', 'https') -notcontains $ParsedEndpoint.Scheme -or -not $ParsedEndpoint.Host) {
      throw 'External telemetry requires a valid ABADA_TELEMETRY_OTLP_ENDPOINT'
    }
    if ((Get-EnvValue 'OTEL_SDK_DISABLED') -ne 'false') {
      throw 'External telemetry requires OTEL_SDK_DISABLED=false'
    }
  }
  elseif (-not $Telemetry -and $TelemetryEnabled -eq 'false') {
    if ((Get-EnvValue 'ABADA_TELEMETRY_OTLP_ENDPOINT') -or (Get-EnvValue 'OTEL_SDK_DISABLED') -ne 'true') {
      throw 'Disabled telemetry requires an empty endpoint and OTEL_SDK_DISABLED=true'
    }
  }
}

function Assert-PortsAvailable {
  $RunningTraefik = (& docker @Compose ps --status running -q traefik 2>$null)
  if ($RunningTraefik) { return }
  $Ports = @([int]80)
  if ($Profile -eq 'prod') { $Ports += 443 }
  if ($Telemetry) {
    $GrafanaPort = Get-EnvValue 'GRAFANA_PORT'
    $Ports += $(if ($GrafanaPort) { [int]$GrafanaPort } else { 3000 })
  }
  $Listening = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port
  foreach ($Port in $Ports) {
    if ($Listening -contains $Port) { throw "TCP port $Port is already in use" }
  }
}

function Assert-DockerStorage {
  $ProbeVolume = "abada-preflight-$([Guid]::NewGuid().ToString('N'))"
  & docker volume create $ProbeVolume | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker cannot create named-volume storage' }
  try {
    & docker volume inspect $ProbeVolume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker cannot inspect named-volume storage' }
  }
  finally {
    & docker volume rm $ProbeVolume | Out-Null
  }
}

function Invoke-Doctor {
  if ($Profile -eq "prod") { Assert-ProductionValues }
  Assert-TelemetryValues
  & docker info | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker is not running" }
  Enable-Rc1Arm64Compatibility
  Assert-DockerStorage
  Invoke-Compose @("config", "--quiet")
  $WriteTest = Join-Path $Root ".abada-write-test-$([Guid]::NewGuid())"
  try { New-Item -ItemType File -Path $WriteTest | Out-Null } finally { Remove-Item $WriteTest -ErrorAction SilentlyContinue }
  Assert-PortsAvailable
  if (-not $NoPull) { Invoke-Compose @("pull", "--quiet") }
  Write-Host "Preflight passed: profile=$Profile telemetry=$Telemetry"
}

switch ($Command) {
  "doctor" { Invoke-Doctor }
  "up" {
    Invoke-Doctor
    Invoke-Compose @("up", "-d", "--wait")
    if ($Profile -eq 'dev') {
      Write-Host 'Abada is ready:'
      Write-Host '  API:      http://api.localhost/api/v1/info'
      Write-Host '  Tenda:    http://tenda.localhost'
      Write-Host '  Orun:     http://orun.localhost'
      Write-Host '  Keycloak: http://keycloak.localhost (admin/admin)'
      Write-Host '  Workflow user: alice/alice (development only)'
    }
    else {
      Write-Host 'Abada production services are healthy:'
      Write-Host "  API:   https://$(Get-EnvValue 'ABADA_API_HOST')/api/v1/info"
      Write-Host "  Tenda: https://$(Get-EnvValue 'ABADA_TASKS_HOST')"
      Write-Host "  Orun:  https://$(Get-EnvValue 'ABADA_OPS_HOST')"
    }
    if ($Telemetry) {
      $GrafanaPort = Get-EnvValue 'GRAFANA_PORT'
      if (-not $GrafanaPort) { $GrafanaPort = '3000' }
      Write-Host "  Grafana: http://127.0.0.1:$GrafanaPort"
    }
    $TelemetryOption = if ($Telemetry) { ' --Telemetry' } else { '' }
    Write-Host "  Health: all required containers passed their health checks"
    Write-Host ".\release\abada-platform.ps1 -Command logs -Profile $Profile -EnvFile `"$EnvFile`"$TelemetryOption"
    Write-Host ".\release\abada-platform.ps1 -Command down -Profile $Profile -EnvFile `"$EnvFile`"$TelemetryOption"
  }
  "down" { Invoke-Compose @("down") }
  "status" { Invoke-Compose @("ps") }
  "logs" { Invoke-Compose @("logs", "-f") }
}
