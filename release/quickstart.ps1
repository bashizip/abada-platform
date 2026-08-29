param(
  [string]$Version = $(if ($env:ABADA_VERSION) { $env:ABADA_VERSION } else { "" }),
  [ValidateSet("dev", "prod")]
  [string]$Profile = $(if ($env:ABADA_PROFILE) { $env:ABADA_PROFILE } else { "dev" }),
  [string]$InstallDirectory = $(if ($env:ABADA_INSTALL_DIR) { $env:ABADA_INSTALL_DIR } else { "" })
)

$ErrorActionPreference = "Stop"
$BaseUrl = if ($env:ABADA_RELEASE_BASE_URL) { $env:ABADA_RELEASE_BASE_URL.TrimEnd('/') } else { "https://install.abadaplatform.com" }
if (-not $Version) {
  $Version = (Invoke-RestMethod -Uri "$BaseUrl/latest").Trim()
}
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$') {
  throw 'Version must be an immutable semantic version'
}
if (-not $InstallDirectory) {
  $InstallDirectory = Join-Path (Get-Location) "abada-platform-$Version"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is required" }
& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required" }

if ($Version -eq '1.0.0-rc.1') {
  $DockerArchitecture = (& docker info --format '{{.Architecture}}').Trim()
  if (@('arm64', 'aarch64') -contains $DockerArchitecture -and -not $env:DOCKER_DEFAULT_PLATFORM) {
    $env:DOCKER_DEFAULT_PLATFORM = 'linux/amd64'
    Write-Warning 'Abada 1.0.0-rc.1 images are amd64-only; Docker compatibility mode is enabled on this ARM host.'
  }
}

$Archive = "abada-platform-$Version.tar.gz"
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null

try {
  $ArchivePath = Join-Path $TemporaryDirectory $Archive
  $ChecksumPath = "$ArchivePath.sha256"
  Write-Host "Downloading Abada $Version release bundle..."
  Invoke-WebRequest -Uri "$BaseUrl/$Archive" -OutFile $ArchivePath
  Invoke-WebRequest -Uri "$BaseUrl/$Archive.sha256" -OutFile $ChecksumPath

  $ChecksumLines = @(Get-Content $ChecksumPath)
  $EscapedArchive = [regex]::Escape($Archive)
  if ($ChecksumLines.Count -ne 1 -or $ChecksumLines[0] -notmatch "^([0-9a-fA-F]{64})  $EscapedArchive$") {
    throw "Checksum file must contain exactly the expected archive entry"
  }
  $Expected = $Matches[1].ToLowerInvariant()
  $Actual = (Get-FileHash -Algorithm SHA256 $ArchivePath).Hash.ToLowerInvariant()
  if ($Expected -ne $Actual) { throw "Release archive checksum verification failed" }

  New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
  tar -xzf $ArchivePath --strip-components=1 -C $InstallDirectory
  Write-Host "Verified and installed Abada at $InstallDirectory"
  $PlatformScript = Join-Path $InstallDirectory "release/abada-platform.ps1"
  if ($Profile -eq 'dev') {
    & $PlatformScript -Command up -Profile dev
    if ($LASTEXITCODE -ne 0) { throw "Abada development quickstart failed" }
  }
  else {
    $ProductionEnv = Join-Path $InstallDirectory '.env.prod'
    if (-not (Test-Path $ProductionEnv)) {
      Copy-Item (Join-Path $InstallDirectory 'release/.env.prod.example') $ProductionEnv
    }
    Write-Host 'Production files are ready, but no services were started.'
    Write-Host "1. Replace every placeholder in $ProductionEnv."
    Write-Host "2. Validate: & '$PlatformScript' -Command doctor -Profile prod -EnvFile '$ProductionEnv'"
    Write-Host "3. Start:    & '$PlatformScript' -Command up -Profile prod -EnvFile '$ProductionEnv'"
  }
}
finally {
  Remove-Item -Recurse -Force $TemporaryDirectory -ErrorAction SilentlyContinue
}
