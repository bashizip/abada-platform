$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
& (Join-Path $Root "release/abada-platform.ps1") -Command up -Profile dev @args
exit $LASTEXITCODE
