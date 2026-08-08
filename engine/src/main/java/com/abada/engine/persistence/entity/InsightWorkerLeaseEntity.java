package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * Singleton worker lease. Replicas acquire it transactionally while
 * processing a window; a stale lease (expired) is reclaimable. Portable
 * across PostgreSQL and H2 so insight behavior is testable everywhere.
 */
@Entity
@Table(name = "insight_worker_lease")
public class InsightWorkerLeaseEntity {

    @Id
    private boolean singleton;

    @Column(name = "worker_id")
    private String workerId;

    @Column(name = "acquired_at")
    private Instant acquiredAt;

    @Column(name = "lease_expires_at")
    private Instant leaseExpiresAt;

    public boolean isSingleton() {
        return singleton;
    }

    public void setSingleton(boolean singleton) {
        this.singleton = singleton;
    }

    public String getWorkerId() {
        return workerId;
    }

    public void setWorkerId(String workerId) {
        this.workerId = workerId;
    }

    public Instant getAcquiredAt() {
        return acquiredAt;
    }

    public void setAcquiredAt(Instant acquiredAt) {
        this.acquiredAt = acquiredAt;
    }

    public Instant getLeaseExpiresAt() {
        return leaseExpiresAt;
    }

    public void setLeaseExpiresAt(Instant leaseExpiresAt) {
        this.leaseExpiresAt = leaseExpiresAt;
    }
}