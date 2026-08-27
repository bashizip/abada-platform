package com.abada.engine.persistence.repository;

import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.persistence.entity.TaskEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface TaskRepository extends JpaRepository<TaskEntity, String> {
    List<TaskEntity> findByProcessInstanceIdAndStatusNotIn(
            String processInstanceId, Collection<TaskStatus> terminalStatuses);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM TaskEntity t WHERE t.id = :taskId")
    Optional<TaskEntity> findByIdForUpdate(@Param("taskId") String taskId);
    
    // User-specific queries
    List<TaskEntity> findByAssigneeAndStatus(String assignee, TaskStatus status);
    
    List<TaskEntity> findByAssigneeOrderByStartDateDesc(String assignee);
    
    @Query("SELECT t FROM TaskEntity t WHERE t.assignee = :assignee ORDER BY t.startDate DESC")
    List<TaskEntity> findRecentTasksByAssignee(@Param("assignee") String assignee);
    
    @Query("SELECT t FROM TaskEntity t WHERE t.assignee = :assignee AND t.status = :status AND t.startDate < :cutoffDate")
    List<TaskEntity> findOverdueTasksByAssignee(@Param("assignee") String assignee, 
                                               @Param("status") TaskStatus status, 
                                               @Param("cutoffDate") Instant cutoffDate);
    
    @Query("SELECT COUNT(t) FROM TaskEntity t WHERE t.assignee = :assignee AND t.status = :status")
    long countByAssigneeAndStatus(@Param("assignee") String assignee, @Param("status") TaskStatus status);
    
    @Query("SELECT t FROM TaskEntity t WHERE t.assignee = :assignee OR :assignee MEMBER OF t.candidateUsers")
    List<TaskEntity> findTasksForUser(@Param("assignee") String assignee);

    @Query(value = """
            SELECT t
            FROM TaskEntity t
            WHERE t.status IN :activeStatuses
              AND (
                    t.assignee = :user
                    OR (
                        t.assignee IS NULL
                        AND (
                            :user MEMBER OF t.candidateUsers
                            OR (
                                :hasGroups = true
                                AND EXISTS (
                                    SELECT candidateTask.id
                                    FROM TaskEntity candidateTask
                                    JOIN candidateTask.candidateGroups candidateGroup
                                    WHERE candidateTask.id = t.id
                                      AND candidateGroup IN :groups
                                )
                            )
                            OR (
                                :principalId IS NOT NULL
                                AND EXISTS (
                                    SELECT m.id
                                    FROM com.abada.engine.persistence.entity.ProjectMemberEntity m
                                    JOIN m.taskGroups tg
                                    WHERE m.principalId = :principalId
                                      AND m.projectId = (
                                          SELECT i.projectId
                                          FROM com.abada.engine.persistence.entity.ProcessInstanceEntity i
                                          WHERE i.id = t.processInstanceId
                                      )
                                      AND EXISTS (
                                          SELECT candidateTask.id
                                          FROM TaskEntity candidateTask
                                          JOIN candidateTask.candidateGroups candidateGroup
                                          WHERE candidateTask.id = t.id
                                            AND candidateGroup = tg
                                      )
                                )
                            )
                        )
                    )
                  )
            """, countQuery = """
            SELECT COUNT(t)
            FROM TaskEntity t
            WHERE t.status IN :activeStatuses
              AND (
                    t.assignee = :user
                    OR (
                        t.assignee IS NULL
                        AND (
                            :user MEMBER OF t.candidateUsers
                            OR (
                                :hasGroups = true
                                AND EXISTS (
                                    SELECT candidateTask.id
                                    FROM TaskEntity candidateTask
                                    JOIN candidateTask.candidateGroups candidateGroup
                                    WHERE candidateTask.id = t.id
                                      AND candidateGroup IN :groups
                                )
                            )
                            OR (
                                :principalId IS NOT NULL
                                AND EXISTS (
                                    SELECT m.id
                                    FROM com.abada.engine.persistence.entity.ProjectMemberEntity m
                                    JOIN m.taskGroups tg
                                    WHERE m.principalId = :principalId
                                      AND m.projectId = (
                                          SELECT i.projectId
                                          FROM com.abada.engine.persistence.entity.ProcessInstanceEntity i
                                          WHERE i.id = t.processInstanceId
                                      )
                                      AND EXISTS (
                                          SELECT candidateTask.id
                                          FROM TaskEntity candidateTask
                                          JOIN candidateTask.candidateGroups candidateGroup
                                          WHERE candidateTask.id = t.id
                                            AND candidateGroup = tg
                                      )
                                )
                            )
                        )
                    )
                  )
            """)
    Page<TaskEntity> findVisibleTasks(
            @Param("user") String user,
            @Param("principalId") String principalId,
            @Param("groups") Collection<String> groups,
            @Param("hasGroups") boolean hasGroups,
            @Param("activeStatuses") Collection<TaskStatus> activeStatuses,
            Pageable pageable);

    @Query(value = """
            SELECT t FROM TaskEntity t
            WHERE t.status IN :activeStatuses
              AND EXISTS (SELECT i.id FROM ProcessInstanceEntity i
                          WHERE i.id = t.processInstanceId AND i.projectId = :projectId)
              AND (t.assignee = :user OR (t.assignee IS NULL AND
                   (:user MEMBER OF t.candidateUsers OR (:hasGroups = true AND EXISTS (
                     SELECT candidateTask.id FROM TaskEntity candidateTask
                     JOIN candidateTask.candidateGroups candidateGroup
                     WHERE candidateTask.id = t.id AND candidateGroup IN :groups)))))
            """, countQuery = """
            SELECT COUNT(t) FROM TaskEntity t
            WHERE t.status IN :activeStatuses
              AND EXISTS (SELECT i.id FROM ProcessInstanceEntity i
                          WHERE i.id = t.processInstanceId AND i.projectId = :projectId)
              AND (t.assignee = :user OR (t.assignee IS NULL AND
                   (:user MEMBER OF t.candidateUsers OR (:hasGroups = true AND EXISTS (
                     SELECT candidateTask.id FROM TaskEntity candidateTask
                     JOIN candidateTask.candidateGroups candidateGroup
                     WHERE candidateTask.id = t.id AND candidateGroup IN :groups)))))
            """)
    Page<TaskEntity> findVisibleTasksByProject(
            @Param("projectId") String projectId, @Param("user") String user,
            @Param("groups") Collection<String> groups, @Param("hasGroups") boolean hasGroups,
            @Param("activeStatuses") Collection<TaskStatus> activeStatuses, Pageable pageable);

    @Query("""
            SELECT t.taskDefinitionKey AS taskDefinitionKey, COUNT(t) AS taskCount
            FROM TaskEntity t
            WHERE t.status IN :activeStatuses
            GROUP BY t.taskDefinitionKey
            """)
    List<ActiveTaskCount> countActiveTasksByDefinitionKey(
            @Param("activeStatuses") Collection<TaskStatus> activeStatuses);

    interface ActiveTaskCount {
        String getTaskDefinitionKey();
        long getTaskCount();
    }
}
