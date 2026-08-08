package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightFindingEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InsightFindingRepository extends JpaRepository<InsightFindingEntity, Long> {

    long countByWindowId(long windowId);

    java.util.List<InsightFindingEntity> findByWindowId(long windowId);
}