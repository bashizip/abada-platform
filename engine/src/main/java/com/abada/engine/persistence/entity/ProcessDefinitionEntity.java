package com.abada.engine.persistence.entity;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "process_definitions")
public class ProcessDefinitionEntity {

    @Id
    @Column(name = "deployment_id")
    private String deploymentId;

    @Column(name = "process_key", nullable = false)
    private String processKey;

    @Column(name = "project_id", nullable = false)
    private String projectId = com.abada.engine.project.ProjectConstants.DEFAULT_PROJECT_ID;

    @Column(nullable = false)
    private int version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(length = 64)
    private String checksum;

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String documentation;

    @Column(columnDefinition = "TEXT")
    private String bpmnXml;

    @Column(name = "candidate_starter_groups")
    private String candidateStarterGroups;

    @Column(name = "candidate_starter_users")
    private String candidateStarterUsers;

    @Column(name = "definition_format_version", nullable = false)
    private String definitionFormatVersion = "legacy-1";

    @Column(name = "schema_type", nullable = false)
    private String schemaType = "BPMN_XML";

    @Column(name = "compatibility_profiles", nullable = false, columnDefinition = "TEXT")
    private String compatibilityProfiles = "standard-bpmn-2.0,abada-native-1,camunda-7";

    @Column(name = "detected_namespaces", nullable = false, columnDefinition = "TEXT")
    private String detectedNamespaces = "";

    @Column(name = "compiler_version", nullable = false)
    private String compilerVersion = "1";

    @Column(name = "compatibility_report", nullable = false, columnDefinition = "TEXT")
    private String compatibilityReport = "{\"detectedProfiles\":[],\"mappings\":[],\"issues\":[]}";

    public ProcessDefinitionEntity() {
        this.deploymentId = UUID.randomUUID().toString();
        this.createdAt = Instant.now();
    }

    public String getId() {
        return processKey;
    }

    public void setId(String id) {
        this.processKey = id;
    }

    public String getDeploymentId() {
        return deploymentId;
    }

    public void setDeploymentId(String deploymentId) {
        this.deploymentId = deploymentId;
    }

    public String getProcessKey() {
        return processKey;
    }

    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }

    public void setProcessKey(String processKey) {
        this.processKey = processKey;
    }

    public int getVersion() {
        return version;
    }

    public void setVersion(int version) {
        this.version = version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public String getChecksum() {
        return checksum;
    }

    public void setChecksum(String checksum) {
        this.checksum = checksum;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDocumentation() {
        return documentation;
    }

    public void setDocumentation(String documentation) {
        this.documentation = documentation;
    }

    public String getBpmnXml() {
        return bpmnXml;
    }

    public void setBpmnXml(String bpmnXml) {
        this.bpmnXml = bpmnXml;
    }

    public String getCandidateStarterGroups() {
        return candidateStarterGroups;
    }

    public void setCandidateStarterGroups(String candidateStarterGroups) {
        this.candidateStarterGroups = candidateStarterGroups;
    }

    public String getCandidateStarterUsers() {
        return candidateStarterUsers;
    }

    public void setCandidateStarterUsers(String candidateStarterUsers) {
        this.candidateStarterUsers = candidateStarterUsers;
    }

    public String getDefinitionFormatVersion() { return definitionFormatVersion; }
    public void setDefinitionFormatVersion(String value) { this.definitionFormatVersion = value; }
    public String getSchemaType() { return schemaType; }
    public void setSchemaType(String value) { this.schemaType = value; }
    public String getCompatibilityProfiles() { return compatibilityProfiles; }
    public void setCompatibilityProfiles(String value) { this.compatibilityProfiles = value; }
    public String getDetectedNamespaces() { return detectedNamespaces; }
    public void setDetectedNamespaces(String value) { this.detectedNamespaces = value; }
    public String getCompilerVersion() { return compilerVersion; }
    public void setCompilerVersion(String value) { this.compilerVersion = value; }
    public String getCompatibilityReport() { return compatibilityReport; }
    public void setCompatibilityReport(String value) { this.compatibilityReport = value; }

}
