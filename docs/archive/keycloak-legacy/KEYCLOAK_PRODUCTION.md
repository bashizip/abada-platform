# Keycloak Production Deployment Guide

## Pre-Deployment Checklist

### Security
- [ ] Change default admin credentials
- [ ] Enable HTTPS (`KC_HTTPS_CERTIFICATE_FILE`, `KC_HTTPS_CERTIFICATE_KEY_FILE`)
- [ ] Set `sslRequired: external` or `all`
- [ ] Configure secrets in vault (not env files)
- [ ] Enable database encryption
- [ ] Restrict admin API access via firewall

### Database
- [ ] Use managed PostgreSQL (RDS, Cloud SQL, etc.)
- [ ] Enable backups (daily minimum)
- [ ] Configure replication/HA
- [ ] Use SSL for database connections
- [ ] Set appropriate resource limits

### Container Orchestration
- [ ] Use Kubernetes or Docker Swarm for orchestration
- [ ] Configure health checks
- [ ] Set resource requests/limits
- [ ] Use private registries for container images
- [ ] Configure auto-restart policies

### Monitoring & Logging
- [ ] Configure centralized logging (ELK, Splunk, etc.)
- [ ] Set up metrics collection (Prometheus)
- [ ] Create alerts for errors and performance
- [ ] Enable audit logging
- [ ] Configure distributed tracing

### Networking
- [ ] Place Keycloak behind reverse proxy/load balancer
- [ ] Configure TLS/SSL certificates
- [ ] Use private networks for database connection
- [ ] Implement rate limiting
- [ ] Configure DDoS protection

## Deployment Architectures

### Single-Instance (Small Teams)
```
┌──────────────────────────────┐
│   Load Balancer (SSL)        │
└──────────────┬───────────────┘
               │
       ┌───────▼────────┐
       │ Keycloak 21.1  │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │  PostgreSQL    │
       │  (Managed)     │
       └────────────────┘
```

### High-Availability (Production)
```
┌─────────────────────────────────────────────────┐
│   CDN / DDoS Protection (CloudFlare, etc.)     │
└────────────────────┬────────────────────────────┘
                     │
    ┌────────────────▼───────────────┐
    │  Load Balancer (SSL Termination)│
    └────┬───────────────────────┬───┘
         │                       │
    ┌────▼────┐          ┌──────▼────┐
    │Keycloak │          │Keycloak   │
    │Instance │          │Instance   │
    │1        │          │2          │
    └────┬────┘          └──────┬────┘
         └────────┬─────────────┘
                  │
    ┌─────────────▼──────────────┐
    │  PostgreSQL (HA Setup)    │
    │  - Primary                │
    │  - Replica/Standby        │
    └──────────────────────────┘
```

## Kubernetes Deployment Example

### StatefulSet
```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: keycloak
spec:
  serviceName: keycloak
  replicas: 2
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:21.1.1
        env:
        - name: KEYCLOAK_ADMIN
          valueFrom:
            secretKeyRef:
              name: keycloak-secrets
              key: admin-username
        - name: KEYCLOAK_ADMIN_PASSWORD
          valueFrom:
            secretKeyRef:
              name: keycloak-secrets
              key: admin-password
        - name: KC_DB
          value: "postgres"
        - name: KC_DB_URL_HOST
          value: "postgres-service.default.svc.cluster.local"
        - name: KC_DB_USERNAME
          valueFrom:
            secretKeyRef:
              name: keycloak-db-secrets
              key: username
        - name: KC_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: keycloak-db-secrets
              key: password
        - name: KC_HTTPS_CERTIFICATE_FILE
          value: "/etc/keycloak/certs/tls.crt"
        - name: KC_HTTPS_CERTIFICATE_KEY_FILE
          value: "/etc/keycloak/certs/tls.key"
        - name: KC_PROXY
          value: "edge"
        ports:
        - containerPort: 8080
          name: http
        - containerPort: 8443
          name: https
        livenessProbe:
          httpGet:
            path: /realms/master
            port: 8080
          initialDelaySeconds: 60
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /realms/master
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 5
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        volumeMounts:
        - name: tls-certs
          mountPath: /etc/keycloak/certs
          readOnly: true
      volumes:
      - name: tls-certs
        secret:
          secretName: keycloak-tls-certs
```

### Service & Ingress
```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak-service
spec:
  type: ClusterIP
  clusterIP: None
  selector:
    app: keycloak
  ports:
  - port: 8080
    name: http
  - port: 8443
    name: https

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: keycloak-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - keycloak.example.com
    secretName: keycloak-tls
  rules:
  - host: keycloak.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: keycloak-service
            port:
              number: 8080
```

## Docker Compose Production Example

```yaml
version: '3.8'

services:
  keycloak:
    image: quay.io/keycloak/keycloak:21.1.1
    container_name: keycloak-prod
    environment:
      KEYCLOAK_ADMIN_USERNAME: ${KC_ADMIN_USERNAME}
      KEYCLOAK_ADMIN_PASSWORD: ${KC_ADMIN_PASSWORD}
      KC_DB: postgres
      KC_DB_URL_HOST: postgres-prod.internal
      KC_DB_URL: jdbc:postgresql://postgres-prod.internal:5432/keycloak
      KC_DB_USERNAME: ${KC_DB_USERNAME}
      KC_DB_PASSWORD: ${KC_DB_PASSWORD}
      KC_HTTPS_CERTIFICATE_FILE: /etc/certs/tls.crt
      KC_HTTPS_CERTIFICATE_KEY_FILE: /etc/certs/tls.key
      KC_HOSTNAME: keycloak.example.com
      KC_PROXY: edge
      KC_LOG_LEVEL: WARN
      KC_METRICS_ENABLED: "true"
    volumes:
      - /etc/letsencrypt/live/keycloak.example.com:/etc/certs
    ports:
      - "8443:8443"
    networks:
      - prod-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "curl", "-f", "https://localhost:8443/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  prod-network:
    external: true
```

## Backup & Restore

### Automated Daily Backups
```bash
#!/bin/bash
# backup-keycloak.sh
BACKUP_DIR=/backups/keycloak
DATE=$(date +%Y%m%d_%H%M%S)

# Backup realm configuration
curl -s -H "Authorization: Bearer $(get_admin_token)" \
  https://keycloak.example.com/admin/realms/abada-dev/export \
  > $BACKUP_DIR/realm_$DATE.json

# Backup database
pg_dump -h postgres-prod.internal \
  -U $KC_DB_USERNAME keycloak \
  | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Upload to S3
aws s3 cp $BACKUP_DIR/ s3://backups/keycloak/
```

### Restore from Backup
```bash
# Restore database
gunzip < db_20240131_120000.sql.gz | \
  psql -h postgres-prod.internal -U $KC_DB_USERNAME keycloak

# Restart Keycloak
docker restart keycloak-prod

# Re-import realm if needed
curl -X POST https://keycloak.example.com/admin/realms/import \
  -H "Authorization: Bearer $(get_admin_token)" \
  -F "file=@realm_20240131_120000.json"
```

## Monitoring & Alerts

### Prometheus Metrics
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'keycloak'
    static_configs:
      - targets: ['keycloak.example.com:8443']
    scheme: https
    tls_config:
      insecure_skip_verify: true
    metrics_path: '/metrics'
```

### Key Alerts
```yaml
- alert: KeycloakHighErrorRate
  expr: rate(keycloak_http_requests_total{status=~"5.."}[5m]) > 0.05
  
- alert: KeycloakDatabaseConnectionPoolExhausted
  expr: keycloak_db_pool_usage > 0.9
  
- alert: KeycloakHighLatency
  expr: histogram_quantile(0.95, keycloak_request_duration) > 1
```

## Scaling Considerations

### Horizontal Scaling
- Use stateless Keycloak instances
- Shared database backend
- Load balancer for distribution
- Session replication via Infinispan

### Vertical Scaling
- Increase container resources
- Adjust JVM heap: `KC_JAVA_OPTS`
- Database tuning (indexes, connection pools)

## Cost Optimization

- Use spot/preemptible instances for HA secondaries
- Compress audit logs
- Archive old realm exports to cold storage
- Monitor and rightsize resources
