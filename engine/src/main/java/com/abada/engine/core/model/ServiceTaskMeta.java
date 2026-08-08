package com.abada.engine.core.model;

import java.io.Serializable;

/**
 * Represents the metadata of a parsed service task from a BPMN file.
 *
 * @param id The ID of the service task node.
 * @param name The name of the service task.
 * @param className The fully qualified class name of the JavaDelegate (for embedded tasks).
 * @param topicName The topic name for external tasks.
 */
public record ServiceTaskMeta(String id, String name, String className, String topicName,
        AgentWorkDescriptor agentWork) implements Serializable {

    public ServiceTaskMeta(String id, String name, String className, String topicName) {
        this(id, name, className, topicName, null);
    }
}
