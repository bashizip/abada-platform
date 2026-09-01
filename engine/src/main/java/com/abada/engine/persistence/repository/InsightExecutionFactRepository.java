package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightExecutionFactEntity;
import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface InsightExecutionFactRepository extends JpaRepository<InsightExecutionFactEntity, Long> {

    boolean existsByVisitId(String visitId);

    long countByDefinitionDeploymentIdAndProcessInstanceIdAndActivityId(
            String deploymentId, String processInstanceId, String activityId);

    java.util.List<InsightExecutionFactEntity>
            findByProjectIdAndDefinitionKeyAndActivityIdAndEndedAtBefore(
                    String projectId, String definitionKey, String activityId, java.time.Instant before);

    java.util.List<InsightExecutionFactEntity>
            findByProjectIdAndDefinitionKeyAndDefinitionDeploymentIdAndActivityIdAndEndedAtBefore(
                    String projectId, String definitionKey, String definitionDeploymentId,
                    String activityId, java.time.Instant before);

    java.util.List<InsightExecutionFactEntity>
            findByEndedAtGreaterThanEqualAndEndedAtLessThanOrderByDefinitionDeploymentId(
                    java.time.Instant from, java.time.Instant to);

    long countByEndedAtGreaterThanEqualAndEndedAtLessThan(java.time.Instant from, java.time.Instant to);
}
