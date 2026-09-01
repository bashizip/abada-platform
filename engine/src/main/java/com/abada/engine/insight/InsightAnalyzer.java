package com.abada.engine.insight;

import com.abada.engine.persistence.entity.InsightExecutionFactEntity;
import com.abada.engine.persistence.entity.InsightExecutionFactEntity.NodeType;
import com.abada.engine.persistence.entity.InsightExecutionFactEntity.Status;
import com.abada.engine.persistence.repository.InsightExecutionFactRepository;
import com.abada.engine.project.ProjectConstants;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Statistical pass over a window of terminal execution facts. Pure Java
 * (portable across PostgreSQL and H2): per-node failure rate, p95 latency
 * against the node's own pre-window baseline, and the fallback/otherwise
 * ratio of deterministic decisions. Only findings above the configured
 * thresholds are produced.
 */
@Component
public class InsightAnalyzer {

    private static final Logger log = LoggerFactory.getLogger(InsightAnalyzer.class);

    private final InsightExecutionFactRepository facts;
    private final InsightProperties properties;

    public InsightAnalyzer(InsightExecutionFactRepository facts, InsightProperties properties) {
        this.facts = facts;
        this.properties = properties;
    }

    public record Baseline(double p95Millis, boolean present) {}

    public record NodeKey(String projectId, String definitionKey, String deploymentId,
                          String nodeId, String nodeType) {
        public NodeKey(String definitionKey, String deploymentId, String nodeId, String nodeType) {
            this(ProjectConstants.DEFAULT_PROJECT_ID, definitionKey, deploymentId, nodeId, nodeType);
        }
    }

    public record Finding(NodeKey key, String summary, String signal, double observed,
                          double threshold, long samples, double severity) {}

    public record Analysis(long factsProcessed, List<Finding> findings) {}

    /** p95 latency for a node from all facts strictly before the window start. */
    public Baseline latencyBaseline(String projectId, String definitionKey, String nodeId, Instant before) {
        List<InsightExecutionFactEntity> prior = facts
                .findByProjectIdAndDefinitionKeyAndActivityIdAndEndedAtBefore(
                        projectId, definitionKey, nodeId, before);
        if (prior.isEmpty()) {
            return new Baseline(0, false);
        }
        List<Long> durations = prior.stream()
                .map(InsightExecutionFactEntity::getDurationMs)
                .sorted()
                .toList();
        return new Baseline(percentile(durations, 0.95), true);
    }

    public Baseline latencyBaseline(String definitionKey, String nodeId, Instant before) {
        return latencyBaseline(ProjectConstants.DEFAULT_PROJECT_ID, definitionKey, nodeId, before);
    }

    /** The 95th percentile of duration samples (interpolated index). */
    public static double percentile(List<Long> sortedMillis, double q) {
        if (sortedMillis.isEmpty()) {
            return 0;
        }
        int idx = Math.max(0, (int) Math.ceil(q * sortedMillis.size()) - 1);
        return sortedMillis.get(Math.min(idx, sortedMillis.size() - 1));
    }

    /**
     * Aggregate the window's terminal facts per (deployment, node) and build
     * findings against the configured thresholds. DECISION nodes only feed the
     * fallback signal; durations only feed the latency signal.
     */
    public Analysis analyze(Instant windowStart, Instant windowEnd) {
        List<InsightExecutionFactEntity> windowFacts =
                facts.findByEndedAtGreaterThanEqualAndEndedAtLessThanOrderByDefinitionDeploymentId(
                        windowStart, windowEnd);

        Map<NodeKey, List<InsightExecutionFactEntity>> byNode = new HashMap<>();
        for (InsightExecutionFactEntity fact : windowFacts) {
            NodeKey key = new NodeKey(fact.getProjectId(), fact.getDefinitionKey(),
                    fact.getDefinitionDeploymentId(),
                    fact.getActivityId(), fact.getNodeType().name());
            byNode.computeIfAbsent(key, k -> new ArrayList<>()).add(fact);
        }
        log.info("Analyzed {} execution facts in window [{}, {}) across {} nodes",
                windowFacts.size(), windowStart, windowEnd, byNode.size());

        int minAttempts = properties.getMinAttempts();
        int minFallback = properties.getMinFallbackSamples();
        double failureThreshold = properties.getFailureRateThreshold();
        double fallbackThreshold = properties.getFallbackRatioThreshold();
        double latencyFactor = properties.getLatencyFactor();

        List<Finding> findings = new ArrayList<>();
        for (Map.Entry<NodeKey, List<InsightExecutionFactEntity>> entry : byNode.entrySet()) {
            NodeKey key = entry.getKey();
            List<InsightExecutionFactEntity> nodeFacts = entry.getValue();
            long attempts = nodeFacts.size();
            long failures = nodeFacts.stream()
                    .filter(f -> f.getStatus() == Status.FAILED)
                    .count();

            if (key.nodeType().equals(NodeType.EXTERNAL_TASK.name())) {
                if (attempts >= minAttempts) {
                    double rate = (double) failures / attempts;
                    if (rate >= failureThreshold) {
                        findings.add(new Finding(key, "High failure rate on external task",
                                "FAILURE_RATE", rate, failureThreshold, attempts,
                                severity(rate, failureThreshold)));
                    }
                }
                List<Long> durations = nodeFacts.stream()
                        .map(InsightExecutionFactEntity::getDurationMs)
                        .sorted()
                        .toList();
                double p95 = percentile(durations, 0.95);
                if (attempts >= minAttempts && !durations.isEmpty()) {
                    Baseline baseline = latencyBaseline(key.projectId(), key.definitionKey(),
                            key.nodeId(), windowStart);
                    if (baseline.present() && p95 >= baseline.p95Millis() * latencyFactor) {
                        findings.add(new Finding(key, "P95 latency above baseline",
                                "LATENCY", p95, baseline.p95Millis() * latencyFactor, attempts,
                                severity(p95 / Math.max(baseline.p95Millis(), 1), latencyFactor)));
                    }
                }
            } else if (key.nodeType().equals(NodeType.DECISION.name())) {
                List<InsightExecutionFactEntity> decisionFacts = new ArrayList<>(facts
                        .findByProjectIdAndDefinitionKeyAndDefinitionDeploymentIdAndActivityIdAndEndedAtBefore(
                                key.projectId(), key.definitionKey(), key.deploymentId(),
                                key.nodeId(), windowStart));
                decisionFacts.addAll(nodeFacts);
                long decisionAttempts = decisionFacts.size();
                long fallbackUses = decisionFacts.stream()
                        .filter(f -> Boolean.TRUE.equals(f.getFallbackUsed()))
                        .count();
                if (decisionAttempts >= minFallback) {
                    double ratio = (double) fallbackUses / decisionAttempts;
                    if (ratio >= fallbackThreshold) {
                        findings.add(new Finding(key, "Decisions landing on the otherwise rule",
                                "FALLBACK_THRASH", ratio, fallbackThreshold, decisionAttempts,
                                severity(ratio, fallbackThreshold)));
                    }
                }
            }
        }
        return new Analysis(windowFacts.size(), findings);
    }

    private double severity(double observed, double threshold) {
        double excess = observed / Math.max(threshold, 0.0001);
        return excess >= 2.0 ? 2.0 : excess >= 1.3 ? 1.0 : 0.5;
    }
}
