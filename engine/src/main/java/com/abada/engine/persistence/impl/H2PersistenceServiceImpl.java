package com.abada.engine.persistence.impl;

import com.abada.engine.persistence.PersistenceService;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.entity.ProcessInstanceEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.project.ProjectConstants;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

@Component
@Service
public class H2PersistenceServiceImpl implements PersistenceService {

    private final ProcessDefinitionRepository processDefinitionRepository;
    private final ProcessInstanceRepository processInstanceRepository;
    private final TaskRepository taskRepository;

    public H2PersistenceServiceImpl(ProcessDefinitionRepository processDefinitionRepository,
                                    ProcessInstanceRepository processInstanceRepository,
                                    TaskRepository taskRepository) {
        this.processDefinitionRepository = processDefinitionRepository;
        this.processInstanceRepository = processInstanceRepository;
        this.taskRepository = taskRepository;
    }

    @Override
    @Transactional
    public ProcessInstanceEntity saveOrUpdateProcessInstance(ProcessInstanceEntity instance) {
        if (instance == null) {
            throw new IllegalArgumentException("ProcessInstance cannot be null");
        }
        return processInstanceRepository.saveAndFlush(instance);
    }
    @Override
    public ProcessDefinitionEntity saveProcessDefinition(ProcessDefinitionEntity definition) {
        return processDefinitionRepository.save(definition);
    }

    @Override
    public TaskEntity saveTask(TaskEntity task) {
        if (task == null) {
            throw new IllegalArgumentException("task cannot be null");
        }
        return taskRepository.saveAndFlush(task);
    }

    @Override
    public TaskEntity findTaskByIdForUpdate(String taskId) {
        return taskRepository.findByIdForUpdate(taskId).orElse(null);
    }

    @Override
    public ProcessDefinitionEntity findProcessDefinitionById(String definitionId) {
        return processDefinitionRepository.findFirstByProjectIdAndProcessKeyOrderByVersionDesc(
                ProjectConstants.DEFAULT_PROJECT_ID, definitionId).orElse(null);
    }

    @Override
    public ProcessDefinitionEntity findProcessDefinitionByProjectAndId(String projectId, String definitionId) {
        return processDefinitionRepository
                .findFirstByProjectIdAndProcessKeyOrderByVersionDesc(projectId, definitionId).orElse(null);
    }

    @Override
    public ProcessDefinitionEntity findProcessDefinitionByDeploymentId(String deploymentId) {
        return processDefinitionRepository.findById(deploymentId).orElse(null);
    }

    @Override
    public ProcessInstanceEntity findProcessInstanceById(String instanceId) {
        return processInstanceRepository.findById(instanceId).orElse(null);
    }

    @Override
    public ProcessInstanceEntity findProcessInstanceByIdForUpdate(String instanceId) {
        return processInstanceRepository.findByIdForUpdate(instanceId).orElse(null);
    }

    @Override
    public List<ProcessDefinitionEntity> findAllProcessDefinitions() {
        return processDefinitionRepository.findAllByOrderByProcessKeyAscVersionDesc();
    }

    @Override
    public Page<ProcessDefinitionEntity> findProcessDefinitions(Pageable pageable) {
        return processDefinitionRepository.findByProjectId(ProjectConstants.DEFAULT_PROJECT_ID, pageable);
    }

    @Override
    public Page<ProcessDefinitionEntity> findProcessDefinitions(String processKey, Pageable pageable) {
        return processKey == null || processKey.isBlank()
                ? processDefinitionRepository.findByProjectId(ProjectConstants.DEFAULT_PROJECT_ID, pageable)
                : processDefinitionRepository.findByProjectIdAndProcessKey(
                        ProjectConstants.DEFAULT_PROJECT_ID, processKey, pageable);
    }

    @Override
    public Page<ProcessDefinitionEntity> findProcessDefinitions(String projectId, String processKey,
            Pageable pageable) {
        return processKey == null || processKey.isBlank()
                ? processDefinitionRepository.findByProjectId(projectId, pageable)
                : processDefinitionRepository.findByProjectIdAndProcessKey(projectId, processKey, pageable);
    }

    @Override
    public Page<ProcessInstanceEntity> findProcessInstances(String projectId, ProcessStatus status,
            String processDefinitionId, Pageable pageable) {
        String definitionFilter = processDefinitionId == null || processDefinitionId.isBlank()
                ? null : processDefinitionId;
        return processInstanceRepository.findFilteredByProject(projectId, status, definitionFilter, pageable);
    }

    @Override
    public Page<ProcessInstanceEntity> findProcessInstances(Pageable pageable) {
        return processInstanceRepository.findFilteredByProject(
                ProjectConstants.DEFAULT_PROJECT_ID, null, null, pageable);
    }

    @Override
    public Page<ProcessInstanceEntity> findProcessInstances(ProcessStatus status, String processDefinitionId,
            Pageable pageable) {
        String definitionFilter = processDefinitionId == null || processDefinitionId.isBlank()
                ? null : processDefinitionId;
        return processInstanceRepository.findFilteredByProject(
                ProjectConstants.DEFAULT_PROJECT_ID, status, definitionFilter, pageable);
    }

    @Override
    public List<ProcessInstanceEntity> findProcessInstancesByIds(Collection<String> instanceIds) {
        return processInstanceRepository.findAllById(instanceIds);
    }

}
