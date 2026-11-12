package com.abada.engine.audit;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read side of the administration audit trail. {@code /v1/admin/**} is restricted
 * to the administrator role by the security configuration; a refused read is itself
 * recorded as {@code audit.read} / {@code DENIED}.
 */
@RestController
@RequestMapping("/v1/admin/audit")
public class AdminAuditController {

    public record AdminAuditEventDTO(long id, Instant occurredAt, String actor, String actorPrincipalId,
            List<String> actorRoles, String action, String targetType, String targetId, String projectId,
            String outcome, String traceId, String clientIp, JsonNode details) {}

    public record AdminAuditPageDTO(List<AdminAuditEventDTO> items, Long nextCursor) {}

    public record AdminAuditCatalogDTO(List<String> actions, List<String> outcomes) {}

    private final AdminAuditQuery query;
    private final ObjectMapper objectMapper;

    public AdminAuditController(AdminAuditQuery query, ObjectMapper objectMapper) {
        this.query = query;
        this.objectMapper = objectMapper;
    }

    /**
     * Newest first. {@code cursor} continues an earlier page (events older than it);
     * {@code after} returns only events newer than it, for live updates.
     */
    @GetMapping
    public ResponseEntity<AdminAuditPageDTO> list(
            @RequestParam(required = false) String from, @RequestParam(required = false) String to,
            @RequestParam(required = false) String actor, @RequestParam(required = false) String action,
            @RequestParam(required = false) String targetType, @RequestParam(required = false) String targetId,
            @RequestParam(required = false) String projectId, @RequestParam(required = false) String outcome,
            @RequestParam(required = false) Long cursor, @RequestParam(required = false) Long after,
            @RequestParam(required = false) Integer limit) {
        int size = limit == null ? AdminAuditQuery.DEFAULT_LIMIT : limit;
        if (size < 1 || size > AdminAuditQuery.MAX_LIMIT) {
            throw invalid("limit must be between 1 and " + AdminAuditQuery.MAX_LIMIT);
        }
        var filter = filter(from, to, actor, action, targetType, targetId, projectId, outcome);
        List<AdminAuditEventEntity> rows = query.page(filter, cursor, after, size + 1);
        boolean more = rows.size() > size;
        List<AdminAuditEventDTO> items = rows.stream().limit(size).map(this::dto).toList();
        Long next = more && after == null ? items.get(items.size() - 1).id() : null;
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new AdminAuditPageDTO(items, next));
    }

    /** The filtered events as CSV, newest first, at most {@value AdminAuditQuery#MAX_EXPORT} rows. */
    @GetMapping(value = "/export", produces = "text/csv")
    public ResponseEntity<byte[]> export(
            @RequestParam(required = false) String from, @RequestParam(required = false) String to,
            @RequestParam(required = false) String actor, @RequestParam(required = false) String action,
            @RequestParam(required = false) String targetType, @RequestParam(required = false) String targetId,
            @RequestParam(required = false) String projectId, @RequestParam(required = false) String outcome) {
        var filter = filter(from, to, actor, action, targetType, targetId, projectId, outcome);
        StringBuilder csv = new StringBuilder(
                "id,occurred_at,actor,actor_roles,action,target_type,target_id,project_id,outcome,trace_id,"
                        + "client_ip,details\r\n");
        Long cursor = null;
        int written = 0;
        while (written < AdminAuditQuery.MAX_EXPORT) {
            List<AdminAuditEventEntity> rows = query.page(filter, cursor, null,
                    Math.min(AdminAuditQuery.MAX_LIMIT * 5, AdminAuditQuery.MAX_EXPORT - written));
            if (rows.isEmpty()) break;
            for (AdminAuditEventEntity row : rows) {
                csv.append(row.getId()).append(',').append(row.getOccurredAt()).append(',')
                        .append(cell(row.getActor())).append(',').append(cell(row.getActorRoles())).append(',')
                        .append(cell(row.getAction())).append(',').append(cell(row.getTargetType())).append(',')
                        .append(cell(row.getTargetId())).append(',').append(cell(row.getProjectId())).append(',')
                        .append(row.getOutcome()).append(',').append(cell(row.getTraceId())).append(',')
                        .append(cell(row.getClientIp())).append(',').append(cell(row.getDetailsJson()))
                        .append("\r\n");
            }
            written += rows.size();
            cursor = rows.get(rows.size() - 1).getId();
        }
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"abada-admin-audit.csv\"")
                .cacheControl(CacheControl.noStore())
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/catalog")
    public AdminAuditCatalogDTO catalog() {
        return new AdminAuditCatalogDTO(AdminAuditActions.ALL,
                Arrays.stream(AdminAuditEventEntity.Outcome.values()).map(Enum::name).toList());
    }

    /** RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula. */
    static String cell(String value) {
        if (value == null) return "";
        String text = value;
        if (!text.isEmpty() && "=+-@\t\r".indexOf(text.charAt(0)) >= 0) text = "'" + text;
        if (text.contains(",") || text.contains("\"") || text.contains("\n") || text.contains("\r")
                || !text.equals(value)) {
            return '"' + text.replace("\"", "\"\"") + '"';
        }
        return text;
    }

    private AdminAuditQuery.Filter filter(String from, String to, String actor, String action, String targetType,
            String targetId, String projectId, String outcome) {
        AdminAuditEventEntity.Outcome parsedOutcome = null;
        if (outcome != null && !outcome.isBlank()) {
            try {
                parsedOutcome = AdminAuditEventEntity.Outcome.valueOf(outcome.strip().toUpperCase());
            } catch (IllegalArgumentException exception) {
                throw invalid("outcome must be SUCCESS or DENIED");
            }
        }
        return new AdminAuditQuery.Filter(instant("from", from), instant("to", to), actor, action, targetType,
                targetId, projectId, parsedOutcome);
    }

    private static Instant instant(String name, String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return Instant.parse(value.strip());
        } catch (DateTimeParseException exception) {
            throw invalid(name + " must be an ISO-8601 instant, for example 2026-11-12T00:00:00Z");
        }
    }

    private AdminAuditEventDTO dto(AdminAuditEventEntity row) {
        JsonNode details = null;
        if (row.getDetailsJson() != null) {
            try {
                details = objectMapper.readTree(row.getDetailsJson());
            } catch (Exception exception) {
                details = null;
            }
        }
        List<String> roles = row.getActorRoles() == null ? List.of()
                : Arrays.stream(row.getActorRoles().split(",")).filter(s -> !s.isBlank()).toList();
        return new AdminAuditEventDTO(row.getId(), row.getOccurredAt(), row.getActor(), row.getActorPrincipalId(),
                roles, row.getAction(), row.getTargetType(), row.getTargetId(), row.getProjectId(),
                row.getOutcome().name(), row.getTraceId(), row.getClientIp(), details);
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
