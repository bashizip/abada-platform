package com.abada.engine.util;

import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.EventSubscriptionRepository;
import com.abada.engine.persistence.repository.IdempotencyRecordRepository;
import com.abada.engine.persistence.repository.InsightExecutionFactRepository;
import com.abada.engine.persistence.repository.InsightFindingRepository;
import com.abada.engine.persistence.repository.InsightObservationWindowRepository;
import com.abada.engine.persistence.repository.InsightProposalRepository;
import com.abada.engine.persistence.repository.InsightProposalReviewRepository;
import com.abada.engine.persistence.repository.InsightApprovalPolicyRepository;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.persistence.repository.OutboxEventRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class DatabaseTestHelper {

    private final ExternalTaskRepository externalTaskRepository;
    private final ActivityHistoryRepository activityHistoryRepository;
    private final EventSubscriptionRepository eventSubscriptionRepository;
    private final IdempotencyRecordRepository idempotencyRecordRepository;
    private final InsightExecutionFactRepository insightExecutionFactRepository;
    private final InsightFindingRepository insightFindingRepository;
    private final InsightObservationWindowRepository insightObservationWindowRepository;
    private final InsightProposalRepository insightProposalRepository;
    private final InsightProposalReviewRepository insightProposalReviewRepository;
    private final InsightApprovalPolicyRepository insightApprovalPolicyRepository;
    private final JobRepository jobRepository;
    private final ProcessInstanceRepository processInstanceRepository;
    private final TaskRepository taskRepository;
    private final ProcessDefinitionRepository processDefinitionRepository;
    private final OutboxEventRepository outboxEventRepository;

    public DatabaseTestHelper(ExternalTaskRepository externalTaskRepository,
            ActivityHistoryRepository activityHistoryRepository,
            EventSubscriptionRepository eventSubscriptionRepository,
            IdempotencyRecordRepository idempotencyRecordRepository,
            InsightExecutionFactRepository insightExecutionFactRepository,
            InsightFindingRepository insightFindingRepository,
            InsightObservationWindowRepository insightObservationWindowRepository,
            InsightProposalRepository insightProposalRepository,
            InsightProposalReviewRepository insightProposalReviewRepository,
            InsightApprovalPolicyRepository insightApprovalPolicyRepository,
            JobRepository jobRepository, ProcessInstanceRepository processInstanceRepository,
            TaskRepository taskRepository, ProcessDefinitionRepository processDefinitionRepository,
            OutboxEventRepository outboxEventRepository) {
        this.externalTaskRepository = externalTaskRepository;
        this.activityHistoryRepository = activityHistoryRepository;
        this.eventSubscriptionRepository = eventSubscriptionRepository;
        this.idempotencyRecordRepository = idempotencyRecordRepository;
        this.insightExecutionFactRepository = insightExecutionFactRepository;
        this.insightFindingRepository = insightFindingRepository;
        this.insightObservationWindowRepository = insightObservationWindowRepository;
        this.insightProposalRepository = insightProposalRepository;
        this.insightProposalReviewRepository = insightProposalReviewRepository;
        this.insightApprovalPolicyRepository = insightApprovalPolicyRepository;
        this.jobRepository = jobRepository;
        this.processInstanceRepository = processInstanceRepository;
        this.taskRepository = taskRepository;
        this.processDefinitionRepository = processDefinitionRepository;
        this.outboxEventRepository = outboxEventRepository;
    }

    @Transactional
    public void cleanup() {
        insightProposalReviewRepository.deleteAll();
        insightProposalRepository.deleteAll();
        insightApprovalPolicyRepository.deleteAll();
        insightFindingRepository.deleteAll();
        insightObservationWindowRepository.deleteAll();
        insightExecutionFactRepository.deleteAll();
        outboxEventRepository.deleteAll();
        activityHistoryRepository.deleteAll();
        eventSubscriptionRepository.deleteAll();
        idempotencyRecordRepository.deleteAll();
        externalTaskRepository.deleteAll();
        jobRepository.deleteAll();
        taskRepository.deleteAll();
        processInstanceRepository.deleteAll();
        processDefinitionRepository.deleteAll();
    }
}
