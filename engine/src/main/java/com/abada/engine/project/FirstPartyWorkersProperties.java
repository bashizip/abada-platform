package com.abada.engine.project;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Service principals that are engine-wide workers: they are bound to every
 * project automatically, so the agentic runtime needs no manual per-project
 * setup.
 */
@Component
@ConfigurationProperties("abada.workers")
public class FirstPartyWorkersProperties {

    /** First-party worker identity, e.g. the standard agent-worker service account. */
    public record FirstPartyWorker(String username, List<String> topics) {}

    private List<FirstPartyWorker> firstParty = List.of();

    public List<FirstPartyWorker> getFirstParty() {
        return firstParty;
    }

    public void setFirstParty(List<FirstPartyWorker> value) {
        firstParty = value == null ? List.of() : value;
    }

    public boolean isEmpty() {
        return firstParty.isEmpty();
    }
}