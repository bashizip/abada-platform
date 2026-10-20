package com.abada.engine.persistence.repository;

import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/** Singleton sweep leases (V42): a conditional update acquires one; the first replica wins. */
@Repository
public interface FileSweepLeaseRepository extends JpaRepository<com.abada.engine.persistence.entity.FileSweepLeaseEntity, String> {

    @Modifying
    @Query(value = "update file_sweep_leases set lease_owner = :owner, lease_expires_at = :until "
            + "where name = :name and (lease_expires_at is null or lease_expires_at < :now) "
            + "and (last_completed_at is null or last_completed_at < :dueBefore)", nativeQuery = true)
    int acquire(@Param("name") String name, @Param("owner") String owner, @Param("now") Instant now,
            @Param("until") Instant until, @Param("dueBefore") Instant dueBefore);

    @Modifying
    @Query(value = "update file_sweep_leases set lease_owner = null, lease_expires_at = null, "
            + "last_completed_at = :now where name = :name and lease_owner = :owner", nativeQuery = true)
    int complete(@Param("name") String name, @Param("owner") String owner, @Param("now") Instant now);

    @Modifying
    @Query(value = "update file_sweep_leases set lease_owner = null, lease_expires_at = null "
            + "where name = :name and lease_owner = :owner", nativeQuery = true)
    int release(@Param("name") String name, @Param("owner") String owner);
}
