package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.EventSubscriptionEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface EventSubscriptionRepository extends JpaRepository<EventSubscriptionEntity, String> {
    boolean existsByProcessInstanceIdAndActivityId(String processInstanceId, String activityId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<EventSubscriptionEntity> findFirstByEventTypeAndEventNameAndCorrelationKeyAndConsumedAtIsNull(
            EventSubscriptionEntity.Type type, String eventName, String correlationKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<EventSubscriptionEntity> findByEventTypeAndEventNameAndConsumedAtIsNullOrderByIdAsc(
            EventSubscriptionEntity.Type type, String eventName);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM EventSubscriptionEntity s WHERE s.eventType = :type "
            + "AND s.eventName = :eventName AND s.correlationKey = :correlationKey "
            + "AND s.consumedAt IS NULL AND EXISTS (SELECT i.id FROM ProcessInstanceEntity i "
            + "WHERE i.id = s.processInstanceId AND i.projectId = :projectId)")
    Optional<EventSubscriptionEntity> findProjectMessage(@Param("projectId") String projectId,
            @Param("type") EventSubscriptionEntity.Type type, @Param("eventName") String eventName,
            @Param("correlationKey") String correlationKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM EventSubscriptionEntity s WHERE s.eventType = :type "
            + "AND s.eventName = :eventName AND s.consumedAt IS NULL "
            + "AND EXISTS (SELECT i.id FROM ProcessInstanceEntity i "
            + "WHERE i.id = s.processInstanceId AND i.projectId = :projectId) ORDER BY s.id")
    List<EventSubscriptionEntity> findProjectSignals(@Param("projectId") String projectId,
            @Param("type") EventSubscriptionEntity.Type type, @Param("eventName") String eventName);
}
