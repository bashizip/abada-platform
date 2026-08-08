package com.abada.engine.security;

import java.util.Locale;

public final class AbadaRoles {
    public static final String ADMIN = "ROLE_ABADA_ADMIN";
    public static final String DEPLOYER = "ROLE_ABADA_DEPLOYER";
    public static final String PROCESS_CONTROLLER = "ROLE_ABADA_PROCESS_CONTROLLER";
    public static final String TASK_USER = "ROLE_ABADA_TASK_USER";
    public static final String OPERATOR = "ROLE_ABADA_OPERATOR";
    public static final String WORKER = "ROLE_ABADA_WORKER";
    public static final String INSIGHT_REVIEWER = "ROLE_ABADA_INSIGHT_REVIEWER";
    public static final String PROJECT_CREATOR = "ROLE_ABADA_PROJECT_CREATOR";

    private AbadaRoles() {}

    public static String fromGroup(String group) {
        if (group == null) return null;
        String normalized = group.strip().replaceFirst("^/", "").replace('-', '_').toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "ABADA_ADMIN" -> ADMIN;
            case "ABADA_DEPLOYER" -> DEPLOYER;
            case "ABADA_PROCESS_CONTROLLER" -> PROCESS_CONTROLLER;
            case "ABADA_TASK_USER" -> TASK_USER;
            case "ABADA_OPERATOR" -> OPERATOR;
            case "ABADA_WORKER" -> WORKER;
            case "ABADA_INSIGHT_REVIEWER" -> INSIGHT_REVIEWER;
            case "ABADA_PROJECT_CREATOR" -> PROJECT_CREATOR;
            default -> null;
        };
    }
}
