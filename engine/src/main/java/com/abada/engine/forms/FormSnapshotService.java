package com.abada.engine.forms;

import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.TaskMeta;
import com.abada.engine.parser.AplParser;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.project.ProjectTreeService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Pins the task form of every human node when its definition is deployed:
 * the FORM resource its {@code formKey} resolves to, parsed and checked, is
 * stored with the definition version ({@code process_definitions.form_snapshots}).
 * Completing a task validates against that snapshot, so editing a form never
 * changes the rules of tasks already open; redeploying picks the edit up.
 *
 * <p>A form key that resolves to no FORM resource is not an error (forms may
 * live outside the project, as with BPMN imports): the task then has no
 * engine-enforced form, as before 1.2. A form that resolves but is invalid
 * fails the deployment.
 */
@Service
public class FormSnapshotService {
    /** A task form that cannot be enforced. */
    public static final String FORM_CODE = "ABADA-FORM-001";
    private static final Logger log = LoggerFactory.getLogger(FormSnapshotService.class);
    private static final TypeReference<Map<String, Snapshot>> SNAPSHOTS = new TypeReference<>() {};

    /** The pinned form of one human node, with the resource revision it came from. */
    public record Snapshot(String formKey, String resourceId, long revision, String sha256, JsonNode schema) {
    }

    /** A snapshot with its parsed schema, ready to enforce. */
    public record Pinned(Snapshot snapshot, FormSchema form) {
    }

    public record Resolution(Map<String, Snapshot> snapshots, List<BpmnValidationIssue> errors) {
        public boolean ok() {
            return errors.isEmpty();
        }
    }

    private final ProjectTreeService trees;
    private final ObjectMapper json;
    /** Immutable per deployment, so caching by deployment id is safe (runtime invariant 3). */
    private final Map<String, Map<String, Pinned>> byDeployment = new ConcurrentHashMap<>();

    public FormSnapshotService(ProjectTreeService trees, ObjectMapper json) {
        this.trees = trees;
        this.json = json;
    }

    public Resolution resolve(String projectId, ParsedProcessDefinition definition) {
        Map<String, Snapshot> snapshots = new TreeMap<>();
        List<BpmnValidationIssue> errors = new ArrayList<>();
        for (TaskMeta task : definition.getUserTasks().values()) {
            String formKey = task.getFormKey();
            if (formKey == null || formKey.isBlank()) continue;
            Optional<ProjectResourceEntity> resource = trees.lookupForm(projectId, formKey);
            if (resource.isEmpty() || resource.get().getKind() != ProjectResourceEntity.Kind.FORM) continue;
            ProjectResourceEntity form = resource.get();
            JsonNode schema;
            try {
                schema = json.readTree(form.getContent());
                FormSchema.parse(schema);
            } catch (IOException exception) {
                errors.add(error(task.getId(), "form '" + formKey + "' is not valid JSON",
                        "Fix forms/" + form.getName() + " in the project, then deploy again"));
                continue;
            } catch (FormSchema.InvalidFormException exception) {
                for (String problem : exception.problems()) {
                    errors.add(error(task.getId(), "form '" + formKey + "': " + problem,
                            "Fix the form in the form designer, then deploy again"));
                }
                continue;
            }
            snapshots.put(task.getId(), new Snapshot(formKey.strip(), form.getId(), form.getEntityVersion(),
                    form.getSha256(), schema));
        }
        return new Resolution(snapshots, errors);
    }

    /** JSON for the definition column; null when the definition pins no form. */
    public String toJson(Map<String, Snapshot> snapshots) {
        if (snapshots == null || snapshots.isEmpty()) return null;
        try {
            return json.writeValueAsString(snapshots);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Serialize pinned task forms failed", exception);
        }
    }

    /** The form pinned to one human node of a deployment, if any. */
    public Optional<Pinned> pinnedFor(String deploymentId, String snapshotsJson, String activityId) {
        if (deploymentId == null || snapshotsJson == null || snapshotsJson.isBlank()) return Optional.empty();
        Map<String, Pinned> pinned = byDeployment.computeIfAbsent(deploymentId, id -> read(id, snapshotsJson));
        return Optional.ofNullable(pinned.get(activityId));
    }

    private Map<String, Pinned> read(String deploymentId, String snapshotsJson) {
        try {
            Map<String, Snapshot> snapshots = json.readValue(snapshotsJson, SNAPSHOTS);
            Map<String, Pinned> pinned = new LinkedHashMap<>();
            snapshots.forEach((activity, snapshot) -> pinned.put(activity,
                    new Pinned(snapshot, FormSchema.parse(snapshot.schema()))));
            return Map.copyOf(pinned);
        } catch (IOException | FormSchema.InvalidFormException exception) {
            // Checked at deploy: an unreadable snapshot means a corrupted row, so refuse rather than guess.
            log.error("Pinned task forms of deployment {} cannot be read", deploymentId);
            throw new IllegalStateException("Pinned task forms of deployment " + deploymentId + " cannot be read",
                    exception);
        }
    }

    private static BpmnValidationIssue error(String nodeId, String message, String resolution) {
        return new BpmnValidationIssue(FORM_CODE, ValidationSeverity.ERROR, message, null, nodeId,
                AplParser.LANGUAGE_VERSION, null, resolution, null);
    }
}
