package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** A singleton lease for a file sweep that one replica runs at a time (V42). */
@Entity
@Table(name = "file_sweep_leases")
public class FileSweepLeaseEntity {
    @Id
    private String name;

    @Column(name = "lease_owner")
    private String leaseOwner;

    @Column(name = "lease_expires_at")
    private Instant leaseExpiresAt;

    @Column(name = "last_completed_at")
    private Instant lastCompletedAt;

    public String getName() { return name; }
    public String getLeaseOwner() { return leaseOwner; }
    public Instant getLeaseExpiresAt() { return leaseExpiresAt; }
    public Instant getLastCompletedAt() { return lastCompletedAt; }
}
