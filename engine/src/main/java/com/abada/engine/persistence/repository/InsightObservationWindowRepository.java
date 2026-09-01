package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightObservationWindowEntity;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InsightObservationWindowRepository
        extends JpaRepository<InsightObservationWindowEntity, Long> {

    /** Cursor for the next window: the newest COMPLETED window's endedAt. */
    default Optional<InsightObservationWindowEntity> findLatestCompleted() {
        return findFirstByStatusOrderByEndedAtDesc(InsightObservationWindowEntity.Status.COMPLETED);
    }

    Optional<InsightObservationWindowEntity> findFirstByStatusOrderByEndedAtDesc(
            InsightObservationWindowEntity.Status status);

    Optional<InsightObservationWindowEntity> findFirstByStatusOrderByStartedAtAsc(
            InsightObservationWindowEntity.Status status);

    boolean existsById(long id);
}
