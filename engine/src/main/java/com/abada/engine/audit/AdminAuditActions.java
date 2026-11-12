package com.abada.engine.audit;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.util.AntPathMatcher;

/**
 * The administrative actions the trail records, and which HTTP call each one is.
 * Successful actions are recorded by the service that performs them, inside its
 * transaction; a refused call is matched here by method and path so that its
 * {@code DENIED} event names the same action.
 */
public final class AdminAuditActions {
    public static final String USER_CREATE = "user.create";
    public static final String USER_UPDATE = "user.update";
    public static final String USER_GROUP_ASSIGN = "user.group.assign";
    public static final String USER_GROUP_REVOKE = "user.group.revoke";
    public static final String GROUP_CREATE = "group.create";
    public static final String PROJECT_CREATE = "project.create";
    public static final String PROJECT_UPDATE = "project.update";
    public static final String PROJECT_ARCHIVE = "project.archive";
    public static final String PROJECT_RESTORE = "project.restore";
    public static final String PROJECT_MEMBER_PUT = "project.member.put";
    public static final String PROJECT_MEMBER_REMOVE = "project.member.remove";
    public static final String PROJECT_WORKER_PUT = "project.worker.put";
    public static final String AI_PROVIDER_SAVE = "ai-provider.save";
    public static final String AI_PROVIDER_DELETE = "ai-provider.delete";
    public static final String TOOL_CREDENTIAL_SAVE = "tool-credential.save";
    public static final String TOOL_CREDENTIAL_DELETE = "tool-credential.delete";
    public static final String EVIDENCE_POLICY_UPDATE = "evidence-policy.update";
    public static final String FILE_POLICY_UPDATE = "file-policy.update";
    public static final String INSIGHT_POLICY_UPDATE = "insight-policy.update";
    public static final String PROCESS_DEPLOY = "process.deploy";
    public static final String PROCESS_ROLLBACK = "process.rollback";
    public static final String PROPOSAL_REVIEW = "proposal.review";
    public static final String PROPOSAL_ADOPT = "proposal.adopt";
    public static final String AUDIT_READ = "audit.read";

    public static final String TARGET_USER = "user";
    public static final String TARGET_GROUP = "group";
    public static final String TARGET_PROJECT = "project";
    public static final String TARGET_PRINCIPAL = "principal";
    public static final String TARGET_AI_PROVIDER = "ai-provider";
    public static final String TARGET_TOOL_CREDENTIAL = "tool-credential";
    public static final String TARGET_PROCESS = "process";
    public static final String TARGET_DOCUMENT = "document";
    public static final String TARGET_PROPOSAL = "proposal";
    public static final String TARGET_AUDIT = "audit";

    /** What a refused call would have done. */
    public record Classified(String action, String targetType, String targetId, String projectId) {}

    private record Route(String method, String pattern, String action, String targetType, String targetVariable) {}

    private static final List<Route> ROUTES = List.of(
            new Route("POST", "/v1/admin/users", USER_CREATE, TARGET_USER, null),
            new Route("PUT", "/v1/admin/users/{userId}/groups/{groupId}", USER_GROUP_ASSIGN, TARGET_USER, "userId"),
            new Route("DELETE", "/v1/admin/users/{userId}/groups/{groupId}", USER_GROUP_REVOKE, TARGET_USER, "userId"),
            new Route("PUT", "/v1/admin/users/{userId}", USER_UPDATE, TARGET_USER, "userId"),
            new Route("POST", "/v1/admin/groups", GROUP_CREATE, TARGET_GROUP, null),
            new Route("GET", "/v1/admin/audit/**", AUDIT_READ, TARGET_AUDIT, null),
            new Route("GET", "/v1/admin/audit", AUDIT_READ, TARGET_AUDIT, null),
            new Route("POST", "/v1/projects", PROJECT_CREATE, TARGET_PROJECT, null),
            new Route("PUT", "/v1/projects/{projectId}", PROJECT_UPDATE, TARGET_PROJECT, "projectId"),
            new Route("POST", "/v1/projects/{projectId}/archive", PROJECT_ARCHIVE, TARGET_PROJECT, "projectId"),
            new Route("PUT", "/v1/projects/{projectId}/members/{principalId}", PROJECT_MEMBER_PUT,
                    TARGET_PRINCIPAL, "principalId"),
            new Route("DELETE", "/v1/projects/{projectId}/members/{principalId}", PROJECT_MEMBER_REMOVE,
                    TARGET_PRINCIPAL, "principalId"),
            new Route("PUT", "/v1/projects/{projectId}/workers/{principalId}", PROJECT_WORKER_PUT,
                    TARGET_PRINCIPAL, "principalId"),
            new Route("PUT", "/v1/projects/{projectId}/tool-credentials/{name}", TOOL_CREDENTIAL_SAVE,
                    TARGET_TOOL_CREDENTIAL, "name"),
            new Route("DELETE", "/v1/projects/{projectId}/tool-credentials/{name}", TOOL_CREDENTIAL_DELETE,
                    TARGET_TOOL_CREDENTIAL, "name"),
            new Route("PUT", "/v1/projects/{projectId}/evidence-policy", EVIDENCE_POLICY_UPDATE,
                    TARGET_PROJECT, "projectId"),
            new Route("PUT", "/v1/projects/{projectId}/file-policy", FILE_POLICY_UPDATE, TARGET_PROJECT, "projectId"),
            new Route("PUT", "/v1/projects/{projectId}/insight/policies/{key}", INSIGHT_POLICY_UPDATE,
                    TARGET_PROCESS, "key"),
            new Route("POST", "/v1/projects/{projectId}/insight/proposals/{proposalId}/reviews", PROPOSAL_REVIEW,
                    TARGET_PROPOSAL, "proposalId"),
            new Route("POST", "/v1/projects/{projectId}/documents/{documentId}/deploy", PROCESS_DEPLOY,
                    TARGET_DOCUMENT, "documentId"),
            new Route("POST", "/v1/projects/{projectId}/processes/{key}/versions/{version}/rollback",
                    PROCESS_ROLLBACK, TARGET_PROCESS, "key"),
            new Route("POST", "/v1/processes/deploy", PROCESS_DEPLOY, TARGET_PROCESS, null),
            new Route("PUT", "/v1/ai-providers/{id}", AI_PROVIDER_SAVE, TARGET_AI_PROVIDER, "id"),
            new Route("DELETE", "/v1/ai-providers/{id}", AI_PROVIDER_DELETE, TARGET_AI_PROVIDER, "id"),
            new Route("PUT", "/v1/insight/policies/{key}", INSIGHT_POLICY_UPDATE, TARGET_PROCESS, "key"),
            new Route("POST", "/v1/insight/proposals/{proposalId}/reviews", PROPOSAL_REVIEW,
                    TARGET_PROPOSAL, "proposalId"),
            // The pre-rc.8 Insight form saves an AI provider.
            new Route("PUT", "/v1/insight/config/ai", AI_PROVIDER_SAVE, TARGET_AI_PROVIDER, null));

    /** Every action, for the Studio filter. */
    public static final List<String> ALL = List.of(USER_CREATE, USER_UPDATE, USER_GROUP_ASSIGN, USER_GROUP_REVOKE,
            GROUP_CREATE, PROJECT_CREATE, PROJECT_UPDATE, PROJECT_ARCHIVE, PROJECT_RESTORE, PROJECT_MEMBER_PUT,
            PROJECT_MEMBER_REMOVE, PROJECT_WORKER_PUT, AI_PROVIDER_SAVE, AI_PROVIDER_DELETE, TOOL_CREDENTIAL_SAVE,
            TOOL_CREDENTIAL_DELETE, EVIDENCE_POLICY_UPDATE, FILE_POLICY_UPDATE, INSIGHT_POLICY_UPDATE,
            PROCESS_DEPLOY, PROCESS_ROLLBACK, PROPOSAL_REVIEW, PROPOSAL_ADOPT, AUDIT_READ);

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    private AdminAuditActions() {}

    /** The administrative action a request is, or empty for every other call. */
    public static Optional<Classified> classify(HttpServletRequest request) {
        String path = request.getRequestURI();
        String context = request.getContextPath();
        if (context != null && !context.isEmpty() && path.startsWith(context)) path = path.substring(context.length());
        return classify(request.getMethod(), path);
    }

    static Optional<Classified> classify(String method, String path) {
        if (method == null || path == null) return Optional.empty();
        if (path.startsWith("/api/")) path = path.substring(4);
        if (path.length() > 1 && path.endsWith("/")) path = path.substring(0, path.length() - 1);
        for (Route route : ROUTES) {
            if (!route.method().equalsIgnoreCase(method) || !MATCHER.match(route.pattern(), path)) continue;
            Map<String, String> variables = route.pattern().contains("{")
                    ? MATCHER.extractUriTemplateVariables(route.pattern(), path) : Map.of();
            String target = route.targetVariable() == null ? null : variables.get(route.targetVariable());
            return Optional.of(new Classified(route.action(), route.targetType(), target, variables.get("projectId")));
        }
        return Optional.empty();
    }
}
