#!/bin/bash
# Check health of key services

echo "Checking Abada Engine Health..."
curl -s http://localhost:5601/api/actuator/health | jq . || echo "Engine not reachable"
 
 echo -e "\n\nChecking Abada Studio Health..."
 curl -I -s http://localhost:5605 || echo "Studio not reachable"

echo -e "\n\nChecking Grafana Health..."
curl -s http://localhost:3000/api/health | jq . || echo "Grafana not reachable"

echo -e "\n\nChecking Prometheus Health..."
curl -s http://localhost:9090/-/healthy || echo "Prometheus not reachable"

echo -e "\n\nChecking Loki Health..."
curl -s http://localhost:3100/ready || echo "Loki not reachable"

echo -e "\n\nDone."
