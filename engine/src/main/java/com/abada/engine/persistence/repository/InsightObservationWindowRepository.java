package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightObservationWindowEntity;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface InsightObservationWindowRepository
        extends JpaRepository<InsightObservationWindowEntity, Long> {

    /** Cursor for the next window: the newest COMPLETED window's endedAt. */
    @Query("SELECT w FROM InsightObservationWindowEntity w WHERE w.status = 'COMPLETED' "
            + "ORDER BY w.endedAt DESC")
    Optional<InsightObservationWindowEntity> findLatestCompleted();

    Optional<InsightObservationWindowEntity> findFirstByStatusOrderByStartedAtAsc(
            InsightObservationWindowEntity.Status status);

    boolean existsById(long id);
}
