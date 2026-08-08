package com.abada.engine.dto;

import java.util.List;

/**
 * Represents a worker's request to fetch and lock available external tasks.
 *
 * @param workerId The unique ID of the worker making the request.
 * @param topics A list of topics the worker is subscribed to.
 * @param lockDuration The duration in milliseconds for which the worker wants to lock the tasks.
 */
public record FetchAndLockRequest(String workerId, List<String> topics, long lockDuration,
        Integer maxTasks, String projectId) {
    public FetchAndLockRequest(String workerId, List<String> topics, long lockDuration) {
        this(workerId, topics, lockDuration, 1, null);
    }

    public FetchAndLockRequest(String workerId, List<String> topics, long lockDuration, Integer maxTasks) {
        this(workerId, topics, lockDuration, maxTasks, null);
    }

    public int effectiveMaxTasks() {
        return maxTasks == null ? 1 : maxTasks;
    }
}
