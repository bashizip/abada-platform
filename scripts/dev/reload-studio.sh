docker build -f studio/Dockerfile.prod -t ghcr.io/bashizip/abada-studio:1.0.0-rc.2 ./studio
docker compose -f compose.yaml -f compose.dev.yaml up -d abada-studio