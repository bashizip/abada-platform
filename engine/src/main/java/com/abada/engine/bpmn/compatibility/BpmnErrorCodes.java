package com.abada.engine.bpmn.compatibility;

public final class BpmnErrorCodes {
    public static final String UNKNOWN_PROFILE = "ABADA-BPMN-PROFILE-001";
    public static final String UNSUPPORTED_EXTENSION = "ABADA-BPMN-EXTENSION-001";
    public static final String CONFLICTING_ASSIGNMENT = "ABADA-BPMN-ASSIGNMENT-001";
    public static final String INVALID_ASSIGNEE = "ABADA-BPMN-ASSIGNMENT-002";
    public static final String INVALID_CANDIDATE_USER = "ABADA-BPMN-ASSIGNMENT-003";
    public static final String INVALID_CANDIDATE_GROUP = "ABADA-BPMN-ASSIGNMENT-004";
    public static final String MIGRATION_UNCERTAIN = "ABADA-BPMN-MIGRATION-001";
    public static final String XML_SECURITY = "ABADA-BPMN-XML-001";
    /** A cycle without a bound, or an invalid abada:maxIterations / abada:onExhausted. */
    public static final String UNBOUNDED_LOOP = "ABADA-BPMN-LOOP-001";
    private BpmnErrorCodes() {}
}
