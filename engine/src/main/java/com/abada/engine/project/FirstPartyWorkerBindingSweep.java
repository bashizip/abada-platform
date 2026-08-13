package com.abada.engine.project;

import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.persistence.repository.ProjectWorkerBindingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Backfills first-party worker bindings for projects created before
 * auto-binding existed. Idempotent and safe on multi-replica startups:
 * a concurrent engine that already inserted the binding makes the insert
 * collide with the unique (project, principal) constraint, which is
 * swallowed and retried on the next startup.
 */
@Component
public class FirstPartyWorkerBindingSweep implements ApplicationRunner {

    private static final Logger LOG = LoggerFactory.getLogger(FirstPartyWorkerBindingSweep.class);

    private final ProjectRepository projects;
    private final ProjectWorkerBindingRepository bindings;
    private final ProjectWorkerService projectWorkers;

    public FirstPartyWorkerBindingSweep(ProjectRepository projects,
            ProjectWorkerBindingRepository bindings, ProjectWorkerService projectWorkers) {
        this.projects = projects;
        this.bindings = bindings;
        this.projectWorkers = projectWorkers;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (ProjectEntity project : projects.findAllByStatus(ProjectEntity.Status.ACTIVE)) {
            try {
                projectWorkers.ensureFirstPartyBindings(project.getId());
            } catch (DataIntegrityViolationException exception) {
                LOG.warn("first_party_binding_conflict project_id={} message={}",
                        project.getId(), exception.getMessage());
            }
        }
    }
}