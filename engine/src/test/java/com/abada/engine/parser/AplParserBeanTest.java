package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** Injected parsers (authoring, insight, validation) enforce the deployment's model allow-list. */
class AplParserBeanTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner().withBean(AplParser.class);

    @Test
    void springBuildsTheParserFromTheConfiguredAllowList() {
        context.withPropertyValues("abada.agent.allowed-models=house-model, other-model")
                .run(started -> assertThat(started.getBean(AplParser.class).allowedAgentModels())
                        .containsExactlyInAnyOrder("house-model", "other-model"));
    }

    @Test
    void withoutConfigurationTheDefaultAllowListApplies() {
        context.run(started -> assertThat(started.getBean(AplParser.class).allowedAgentModels())
                .contains("gpt-5-mini"));
    }
}
