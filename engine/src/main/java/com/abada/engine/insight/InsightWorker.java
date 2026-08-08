package com.abada.engine.insight;

import com.abada.engine.insight.InsightAnalyzer.Analysis;
import com.abada.engine.insight.InsightAnalyzer.Finding;
import com.abada.engine.persistence.entity.InsightFindingEntity;
import com.abada.engine.persistence.entity.InsightObservationWindowEntity;
import com.abada.engine.persistence.repository.InsightFindingRepository;
import com.abada.engine.persistence.repository.InsightObservationWindowRepository;
import com.abada.engine.persistence.repository.InsightWorkerLeaseRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * One window-processing cycle. Runs inside a singleton lease so multiple
 * engine replicas cannot process overlapping or competing windows: one run
 * advances the window cursor from the last COMPLETED window to
 * (now - drift), classifies every facts row that became terminal in between,
 * persists findings, and asks the generator for proposals.
 *
 * Window preparation and completion use short transactions. Proposal
 * generation deliberately runs between them, outside a database transaction,
 * so an LLM call never holds workflow or lease-row locks. A prepared ANALYZED
 * window is durable and can be resumed after a crash.
 */
@Service
public class InsightWorker {

    private static final Logger log = LoggerFactory.getLogger(InsightWorker.class);

    private final InsightProperties properties;
    private final InsightAnalyzer analyzer;
    private final InsightFindingRepository findingsRepository;
    private final InsightObservationWindowRepository windowsRepository;
    private final InsightWorkerLeaseRepository leaseRepository;
    private final InsightProposalService proposalService;
    private final TransactionTemplate transactions;

    public InsightWorker(InsightProperties properties, InsightAnalyzer analyzer,
            InsightFindingRepository findingsRepository,
            InsightObservationWindowRepository windowsRepository,
            InsightWorkerLeaseRepository leaseRepository,
            InsightProposalService proposalService,
            PlatformTransactionManager transactionManager) {
        this.properties = properties;
        this.analyzer = analyzer;
        this.findingsRepository = findingsRepository;
        this.windowsRepository = windowsRepository;
        this.leaseRepository = leaseRepository;
        this.proposalService = proposalService;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public enum RunOutcome { SKIPPED_NO_LEASE, NOT_ENABLED, EMPTY, PROCESSED }

    public RunOutcome runCycle() {
        if (!properties.isEnabled()) {
            return RunOutcome.NOT_ENABLED;
        }
        Instant now = Instant.now();
        PreparedWindow prepared = transactions.execute(status -> prepareWindow(now));
        if (prepared == null) return RunOutcome.SKIPPED_NO_LEASE;
        try {
            // Intentionally outside a DB transaction: the optional LLM call
            // cannot hold locks or participate in workflow-state commits.
            int proposals = proposalService.createProposalsForWindow(prepared.windowId(), prepared.findings());
            transactions.executeWithoutResult(status -> completeWindow(prepared.windowId(), proposals, now));
            log.info("Processed insight window {} across {} facts: {} findings, {} proposals",
                    prepared.windowId(), prepared.factsProcessed(), prepared.findings().size(), proposals);
            return RunOutcome.PROCESSED;
        } catch (RuntimeException exception) {
            transactions.executeWithoutResult(status -> failWindow(prepared.windowId(), exception, now));
            throw exception;
        }
    }

    private PreparedWindow prepareWindow(Instant now) {
        if (!leaseRepository.tryAcquire(properties.getWorkerId(), now,
                now.plus(properties.getLease()))) {
            return null;
        }

        Optional<InsightObservationWindowEntity> pending = windowsRepository
                .findFirstByStatusOrderByStartedAtAsc(InsightObservationWindowEntity.Status.ANALYZED);
        if (pending.isPresent()) {
            InsightObservationWindowEntity window = pending.get();
            return new PreparedWindow(window.getId(), window.getFactsProcessed(),
                    findingsRepository.findByWindowId(window.getId()).stream().map(this::toFinding).toList());
        }

        Optional<InsightObservationWindowEntity> latest = windowsRepository.findLatestCompleted();
        Instant since = latest.map(InsightObservationWindowEntity::getEndedAt)
                .orElseGet(() -> now.minus(properties.getInitialLookback()));
        Instant until = now.minus(properties.getDrift());
        if (!until.isAfter(since)) {
            leaseRepository.release(properties.getWorkerId(), now);
            return null;
        }

        InsightObservationWindowEntity window = new InsightObservationWindowEntity();
        window.setStartedAt(since);
        window.setEndedAt(until);
        window.setStatus(InsightObservationWindowEntity.Status.ANALYZED);
        window = windowsRepository.save(window);
        long windowId = window.getId();

        Analysis analysis = analyzer.analyze(since, until);
        window.setFactsProcessed(Math.toIntExact(analysis.factsProcessed()));
        for (Finding finding : analysis.findings()) {
            InsightFindingEntity entity = new InsightFindingEntity();
            entity.setProjectId(finding.key().projectId());
            entity.setWindowId(windowId);
            entity.setDefinitionKey(definitionKeyOf(finding));
            entity.setDefinitionDeploymentId(finding.key().deploymentId());
            entity.setNodeId(finding.key().nodeId());
            entity.setNodeType(finding.key().nodeType());
            entity.setSignalType(mapSignal(finding.signal()));
            entity.setSeverity(mapSeverity(finding.severity()));
            entity.setObservedValue(finding.observed());
            entity.setThreshold(finding.threshold());
            entity.setSampleCount((int) finding.samples());
            entity.setSummary(finding.summary());
            entity.setCreatedAt(now);
            findingsRepository.save(entity);
        }
        window.setFindingsCount(analysis.findings().size());

        windowsRepository.save(window);
        return new PreparedWindow(windowId, analysis.factsProcessed(), List.copyOf(analysis.findings()));
    }

    private void completeWindow(long windowId, int proposals, Instant now) {
        InsightObservationWindowEntity window = windowsRepository.findById(windowId).orElseThrow();
        window.setProposalsCount(proposals);
        window.setStatus(InsightObservationWindowEntity.Status.COMPLETED);
        window.setCompletedAt(now);
        windowsRepository.save(window);
        leaseRepository.release(properties.getWorkerId(), now);
    }

    private void failWindow(long windowId, RuntimeException exception, Instant now) {
        windowsRepository.findById(windowId).ifPresent(window -> {
            window.setStatus(InsightObservationWindowEntity.Status.FAILED);
            window.setCompletedAt(now);
            String message = exception.getMessage();
            window.setErrorMessage(message == null ? exception.getClass().getSimpleName()
                    : message.substring(0, Math.min(message.length(), 1000)));
            windowsRepository.save(window);
        });
        leaseRepository.release(properties.getWorkerId(), now);
    }

    private Finding toFinding(InsightFindingEntity entity) {
        String signal = entity.getSignalType() == InsightFindingEntity.SignalType.LATENCY_P95
                ? "LATENCY" : entity.getSignalType().name();
        double severity = switch (entity.getSeverity()) {
            case HIGH -> 2.0;
            case MEDIUM -> 1.0;
            case LOW -> 0.5;
        };
        return new Finding(new InsightAnalyzer.NodeKey(entity.getProjectId(), entity.getDefinitionKey(),
                entity.getDefinitionDeploymentId(), entity.getNodeId(), entity.getNodeType()),
                entity.getSummary(), signal, entity.getObservedValue(), entity.getThreshold(),
                entity.getSampleCount(), severity);
    }

    private record PreparedWindow(long windowId, long factsProcessed, List<Finding> findings) {}

    /** No key lookup here: the definition itself is what the proposal targets. */
    private String definitionKeyOf(Finding finding) {
        return finding.key().definitionKey();
    }

    private InsightFindingEntity.SignalType mapSignal(String signal) {
        return switch (signal) {
            case "FAILURE_RATE" -> InsightFindingEntity.SignalType.FAILURE_RATE;
            case "LATENCY" -> InsightFindingEntity.SignalType.LATENCY_P95;
            case "FALLBACK_THRASH" -> InsightFindingEntity.SignalType.FALLBACK_THRASH;
            default -> InsightFindingEntity.SignalType.LATENCY_P95;
        };
    }

    private InsightFindingEntity.Severity mapSeverity(double severity) {
        return severity >= 2.0 ? InsightFindingEntity.Severity.HIGH
                : severity >= 1.0 ? InsightFindingEntity.Severity.MEDIUM
                : InsightFindingEntity.Severity.LOW;
    }
}
