package com.abada.engine.config;

import com.abada.engine.expression.ExecutionPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

/** Applies the operator execution policy (scripts, Java delegates) at startup. */
@Configuration
public class ExecutionPolicyConfiguration {
    private static final Logger log = LoggerFactory.getLogger(ExecutionPolicyConfiguration.class);

    public ExecutionPolicyConfiguration(
            @Value("${" + ExecutionPolicy.SCRIPTS_ENABLED + ":false}") boolean scriptsEnabled,
            @Value("${" + ExecutionPolicy.ALLOWED_DELEGATES + ":}") String allowedDelegates) {
        ExecutionPolicy.configure(scriptsEnabled, allowedDelegates);
        log.info("Execution policy: scripts {}, {} allowed Java delegate class(es)",
                scriptsEnabled ? "enabled (sandboxed)" : "disabled", ExecutionPolicy.allowedDelegates().size());
    }
}
