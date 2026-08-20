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
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProjectMemberRepository;
import com.abada.engine.persistence.repository.ProjectFolderRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import com.abada.engine.persistence.repository.ProjectProcessDocumentRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.persistence.repository.ProjectWorkerBindingRepository;
import com.abada.engine.persistence.repository.WorkerCapabilityRepository;
import com.abada.engine.persistence.repository.WorkerHealthRepository;
import com.abada.engine.project.ProjectConstants;
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
    private final ProjectProcessDocumentRepository projectProcessDocumentRepository;
    private final ProjectFolderRepository projectFolderRepository;
    private final ProjectResourceRepository projectResourceRepository;
    private final ProjectWorkerBindingRepository projectWorkerBindingRepository;
    private final WorkerCapabilityRepository workerCapabilityRepository;
    private final WorkerHealthRepository workerHealthRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final PrincipalRepository principalRepository;
    private final ProjectRepository projectRepository;

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
            OutboxEventRepository outboxEventRepository,
            ProjectProcessDocumentRepository projectProcessDocumentRepository,
            ProjectFolderRepository projectFolderRepository,
            ProjectResourceRepository projectResourceRepository,
            ProjectWorkerBindingRepository projectWorkerBindingRepository,
            WorkerCapabilityRepository workerCapabilityRepository,
            WorkerHealthRepository workerHealthRepository,
            ProjectMemberRepository projectMemberRepository, PrincipalRepository principalRepository,
            ProjectRepository projectRepository) {
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
        this.projectProcessDocumentRepository = projectProcessDocumentRepository;
        this.projectFolderRepository = projectFolderRepository;
        this.projectResourceRepository = projectResourceRepository;
        this.projectWorkerBindingRepository = projectWorkerBindingRepository;
        this.workerCapabilityRepository = workerCapabilityRepository;
        this.workerHealthRepository = workerHealthRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.principalRepository = principalRepository;
        this.projectRepository = projectRepository;
    }

    @Transactional
    public void cleanup() {
        projectProcessDocumentRepository.deleteAll();
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
        projectWorkerBindingRepository.deleteAll();
        workerCapabilityRepository.deleteAll();
        workerHealthRepository.deleteAll();
        projectMemberRepository.deleteAll();
        principalRepository.deleteAll();
        projectResourceRepository.deleteAll();
        deleteFolderTree(projectFolderRepository.findAll());
        projectRepository.findAll().stream()
                .filter(project -> !ProjectConstants.DEFAULT_PROJECT_ID.equals(project.getId()))
                .forEach(projectRepository::delete);
    }

    private void deleteFolderTree(java.util.List<com.abada.engine.persistence.entity.ProjectFolderEntity> folders) {
        var byId = new java.util.HashMap<String, com.abada.engine.persistence.entity.ProjectFolderEntity>();
        for (var folder : folders) byId.put(folder.getId(), folder);
        folders.stream()
                .sorted(java.util.Comparator.comparingInt(
                        (com.abada.engine.persistence.entity.ProjectFolderEntity folder) ->
                                folderDepth(byId, folder)).reversed())
                .forEach(projectFolderRepository::delete);
    }

    private int folderDepth(java.util.Map<String, com.abada.engine.persistence.entity.ProjectFolderEntity> byId,
            com.abada.engine.persistence.entity.ProjectFolderEntity folder) {
        int depth = 0;
        while (folder.getParentId() != null) {
            depth++;
            folder = byId.get(folder.getParentId());
            if (folder == null) break;
        }
        return depth;
    }
}
