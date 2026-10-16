package com.abada.engine.llm;

import com.abada.engine.persistence.entity.AiRefreshStateEntity;
import com.abada.engine.persistence.repository.AiRefreshStateRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Short leases on background refreshes, so that across replicas one engine at a
 * time refreshes a given thing. Claim and finish are their own transactions; the
 * refresh itself (a remote call) runs between them, outside any transaction.
 */
@Component
public class AiRefreshLeases {
    static final Duration LEASE = Duration.ofMinutes(5);

    private final AiRefreshStateRepository states;
    private final TransactionTemplate transactions;
    @PersistenceContext
    private EntityManager entityManager;

    public AiRefreshLeases(AiRefreshStateRepository states, PlatformTransactionManager transactionManager) {
        this.states = states;
        this.transactions = new TransactionTemplate(transactionManager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Claims {@code id} when it was never refreshed, is older than {@code staleAfter}
     * or {@code force} is set, and no other replica holds it. Returns whether to refresh.
     */
    public boolean claim(String id, Duration staleAfter, boolean force) {
        try {
            return Boolean.TRUE.equals(transactions.execute(status -> {
                Instant now = Instant.now();
                AiRefreshStateEntity state = states.lockById(id).orElse(null);
                if (state == null) {
                    // persist, never save(): save() merges, and a merge onto a row another
                    // replica just committed would overwrite its claim. A concurrent first
                    // claim fails here on the primary key and is reported as not claimed.
                    state = new AiRefreshStateEntity();
                    state.setId(id);
                    entityManager.persist(state);
                    entityManager.flush();
                }
                if (state.getClaimedUntil() != null && state.getClaimedUntil().isAfter(now)) return false;
                boolean stale = state.getRefreshedAt() == null || state.getRefreshedAt().plus(staleAfter).isBefore(now);
                if (!force && !stale) return false;
                state.setClaimedUntil(now.plus(LEASE));
                states.save(state);
                return true;
            }));
        } catch (DataIntegrityViolationException | jakarta.persistence.PersistenceException createdByAnotherReplica) {
            return false;
        }
    }

    /** Records the outcome and releases the lease; a failure keeps the last good refresh time. */
    public void finish(String id, boolean success, String message, Integer count) {
        transactions.executeWithoutResult(status -> states.lockById(id).ifPresent(state -> {
            state.setClaimedUntil(null);
            state.setStatus(success ? "OK" : "FAILED");
            state.setMessage(message == null ? null : message.substring(0, Math.min(message.length(), 1000)));
            if (success) {
                state.setRefreshedAt(Instant.now());
                state.setItemCount(count);
            }
            states.save(state);
        }));
    }

    public Optional<AiRefreshStateEntity> state(String id) {
        return transactions.execute(status -> states.findById(id));
    }
}
