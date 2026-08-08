package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightWorkerLeaseEntity;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Singleton worker lease acquired inside the window-processing transaction:
 * the row is looked up with FOR UPDATE, so concurrent replicas serialize at
 * the lease instead of racing window boundaries. A stale (expired) lease is
 * always reclaimable.
 */
@Repository
public class InsightWorkerLeaseRepository {

    private final EntityManager entityManager;

    public InsightWorkerLeaseRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Transactional
    public boolean tryAcquire(String workerId, Instant now, Instant expiresAt) {
        InsightWorkerLeaseEntity lease = findForUpdate();
        if (lease == null) {
            lease = new InsightWorkerLeaseEntity();
            lease.setSingleton(true);
            entityManager.persist(lease);
        }
        if (lease.getLeaseExpiresAt() != null && lease.getLeaseExpiresAt().isAfter(now)) {
            return false;
        }
        lease.setWorkerId(workerId);
        lease.setAcquiredAt(now);
        lease.setLeaseExpiresAt(expiresAt);
        entityManager.merge(lease);
        return true;
    }

    @Transactional
    public void release(String workerId, Instant now) {
        InsightWorkerLeaseEntity lease = findForUpdate();
        if (lease != null && workerId.equals(lease.getWorkerId())) {
            lease.setLeaseExpiresAt(now);
            entityManager.merge(lease);
        }
    }

    private InsightWorkerLeaseEntity findForUpdate() {
        return entityManager.find(InsightWorkerLeaseEntity.class, true, LockModeType.PESSIMISTIC_WRITE);
    }
}