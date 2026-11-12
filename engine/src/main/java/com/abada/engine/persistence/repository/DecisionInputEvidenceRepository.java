package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.DecisionInputEvidenceEntity;
import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DecisionInputEvidenceRepository extends JpaRepository<DecisionInputEvidenceEntity, String> {

    /** Clears every payload past its retention; idempotent, so replicas may sweep at once. */
    @Modifying
    @Query("update DecisionInputEvidenceEntity d set d.inputsEnc = null, d.purgedAt = :now "
            + "where d.purgeAfter <= :now and d.purgedAt is null and d.inputsEnc is not null")
    int purgeDue(@Param("now") Instant now);
}
