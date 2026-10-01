package com.abada.engine.bpmn.compatibility;

/**
 * A validation finding. {@code path} is a JSON Pointer into the source document
 * (APL only, e.g. {@code /flow/nodes/3/temperature}); it is null for BPMN.
 */
public record BpmnValidationIssue(
        String code,
        ValidationSeverity severity,
        String message,
        String processDefinitionId,
        String elementId,
        String namespace,
        SourceLocation sourceLocation,
        String suggestedResolution,
        String path) {

    public BpmnValidationIssue(String code, ValidationSeverity severity, String message,
            String processDefinitionId, String elementId, String namespace,
            SourceLocation sourceLocation, String suggestedResolution) {
        this(code, severity, message, processDefinitionId, elementId, namespace, sourceLocation,
                suggestedResolution, null);
    }

    public BpmnValidationIssue withLocation(String elementId, String path) {
        return new BpmnValidationIssue(code, severity, message, processDefinitionId,
                this.elementId == null ? elementId : this.elementId, namespace, sourceLocation,
                suggestedResolution, this.path == null ? path : this.path);
    }
}
