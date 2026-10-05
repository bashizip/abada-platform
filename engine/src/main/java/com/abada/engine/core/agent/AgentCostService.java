package com.abada.engine.core.agent;

import com.abada.engine.dto.InstanceCostDto;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Agent cost per instance: journaled steps plus the tokens attempts reported
 * without journaling (never both for one attempt), in two grouped queries per
 * page of instances.
 */
@Service
public class AgentCostService {
    private final AgentStepRepository steps;
    private final ExternalTaskRepository externalTasks;

    public AgentCostService(AgentStepRepository steps, ExternalTaskRepository externalTasks) {
        this.steps = steps;
        this.externalTasks = externalTasks;
    }

    /** Cost by instance id; instances without agent calls are absent. */
    @Transactional(readOnly = true)
    public Map<String, InstanceCostDto> costs(Collection<String> instanceIds) {
        Map<String, InstanceCostDto> costs = new HashMap<>();
        if (instanceIds == null || instanceIds.isEmpty()) return costs;
        List<AgentStepRepository.CostRow> rows = new java.util.ArrayList<>(steps.costByInstance(instanceIds));
        rows.addAll(externalTasks.attemptCostByInstance(instanceIds));
        for (AgentStepRepository.CostRow row : rows) {
            long prompt = row.getPromptTokens() == null ? 0 : row.getPromptTokens();
            long completion = row.getCompletionTokens() == null ? 0 : row.getCompletionTokens();
            boolean unpriced = row.getUnpriced() != null && row.getUnpriced() > 0;
            if (row.getUsd() == null && prompt == 0 && completion == 0 && !unpriced) continue;
            costs.merge(row.getInstanceId(), new InstanceCostDto(row.getUsd(), prompt, completion, unpriced),
                    (left, right) -> new InstanceCostDto(add(left.usd(), right.usd()),
                            left.promptTokens() + right.promptTokens(),
                            left.completionTokens() + right.completionTokens(),
                            left.includesUnpriced() || right.includesUnpriced()));
        }
        return costs;
    }

    public InstanceCostDto cost(String instanceId) {
        return costs(List.of(instanceId)).get(instanceId);
    }

    private static BigDecimal add(BigDecimal left, BigDecimal right) {
        if (left == null) return right;
        return right == null ? left : left.add(right);
    }
}
