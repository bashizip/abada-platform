package com.abada.engine.audit;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads the trail newest first with a keyset cursor on {@code id}: a page never
 * repeats or skips an event already shown, however many are inserted meanwhile.
 */
@Component
public class AdminAuditQuery {
    public static final int DEFAULT_LIMIT = 50;
    public static final int MAX_LIMIT = 200;
    public static final int MAX_EXPORT = 10_000;

    /** Every filter is optional; text filters match exactly. */
    public record Filter(Instant from, Instant to, String actor, String action, String targetType,
            String targetId, String projectId, AdminAuditEventEntity.Outcome outcome) {}

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public List<AdminAuditEventEntity> page(Filter filter, Long before, Long after, int limit) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<AdminAuditEventEntity> query = cb.createQuery(AdminAuditEventEntity.class);
        Root<AdminAuditEventEntity> event = query.from(AdminAuditEventEntity.class);
        List<Predicate> where = predicates(cb, event, filter);
        if (before != null) where.add(cb.lessThan(event.get("id"), before));
        if (after != null) where.add(cb.greaterThan(event.get("id"), after));
        query.select(event).where(where.toArray(Predicate[]::new)).orderBy(cb.desc(event.get("id")));
        return entityManager.createQuery(query).setMaxResults(limit).getResultList();
    }

    private static List<Predicate> predicates(CriteriaBuilder cb, Root<AdminAuditEventEntity> event, Filter filter) {
        List<Predicate> where = new ArrayList<>();
        if (filter == null) return where;
        if (filter.from() != null) where.add(cb.greaterThanOrEqualTo(event.get("occurredAt"), filter.from()));
        if (filter.to() != null) where.add(cb.lessThan(event.get("occurredAt"), filter.to()));
        equal(cb, event, where, "actor", filter.actor());
        equal(cb, event, where, "action", filter.action());
        equal(cb, event, where, "targetType", filter.targetType());
        equal(cb, event, where, "targetId", filter.targetId());
        equal(cb, event, where, "projectId", filter.projectId());
        if (filter.outcome() != null) where.add(cb.equal(event.get("outcome"), filter.outcome()));
        return where;
    }

    private static void equal(CriteriaBuilder cb, Root<AdminAuditEventEntity> event, List<Predicate> where,
            String field, String value) {
        if (value != null && !value.isBlank()) where.add(cb.equal(event.get(field), value.strip()));
    }
}
