package com.abada.engine.core;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * One thread of execution in a process instance. Its id is stable for the
 * whole branch: a fork suspends the forking token and creates one child per
 * branch; the join consumes the children and resumes the forking token, so the
 * same id continues after the join. An event gateway parks its incoming token
 * and creates one waiting child per competing catch event; the winning child is
 * consumed and its parent continues.
 */
public final class ProcessToken {

    public enum State {
        /** Moving through the graph inside the current command; never left behind by a command. */
        ACTIVE,
        /** Parked at a wait state (user task, external task, catch event). */
        WAITING,
        /** Parked at a parallel or inclusive join. */
        ARRIVED,
        /** Suspended at a fork until the join resumes it. */
        FORKED,
        /** Parked at an event gateway while its catch-event children wait. */
        EVENT_WAIT,
        /** Stopped at a loop step whose limit was reached with no on_exhausted route; an incident is open. */
        INCIDENT,
        COMPLETED,
        CONSUMED,
        CANCELLED;

        public boolean isLive() {
            return this == ACTIVE || this == WAITING || this == ARRIVED || this == FORKED || this == EVENT_WAIT
                    || this == INCIDENT;
        }
    }

    private final String id;
    private final String parentTokenId;
    private final String scopeTokenId;
    private final Instant createdAt;
    private String activityId;
    private State state;
    private int loopCounter;
    /** Passes of each loop step this token is in; children of a fork start from their parent's counts. */
    private final Map<String, Integer> loopCounts = new LinkedHashMap<>();
    private Instant updatedAt;
    private boolean dirty;

    private ProcessToken(String id, String activityId, State state, String parentTokenId, String scopeTokenId,
            int loopCounter, Map<String, Integer> loopCounts, Instant createdAt, Instant updatedAt, boolean dirty) {
        this.id = id;
        if (loopCounts != null) this.loopCounts.putAll(loopCounts);
        this.activityId = activityId;
        this.state = state;
        this.parentTokenId = parentTokenId;
        this.scopeTokenId = scopeTokenId;
        this.loopCounter = loopCounter;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.dirty = dirty;
    }

    static ProcessToken create(String activityId, State state, String parentTokenId, String scopeTokenId,
            Map<String, Integer> inheritedLoopCounts, Instant createdAt) {
        return new ProcessToken(UUID.randomUUID().toString(), activityId, state, parentTokenId, scopeTokenId, 0,
                inheritedLoopCounts, createdAt, createdAt, true);
    }

    /** A token loaded from storage; it is not dirty until it changes. */
    public static ProcessToken restore(String id, String activityId, State state, String parentTokenId,
            String scopeTokenId, int loopCounter, Map<String, Integer> loopCounts, Instant createdAt,
            Instant updatedAt) {
        return new ProcessToken(id, activityId, state, parentTokenId, scopeTokenId, loopCounter, loopCounts,
                createdAt, updatedAt, false);
    }

    void moveTo(String activityId, State state) {
        if (state == this.state && activityId.equals(this.activityId)) return;
        this.activityId = activityId;
        this.state = state;
        this.updatedAt = Instant.now();
        this.dirty = true;
    }

    /** Records the current pass of a loop step; the loop counter mirrors the latest one. */
    void setLoopCount(String loopStepId, int count) {
        if (Integer.valueOf(count).equals(loopCounts.get(loopStepId)) && loopCounter == count) return;
        loopCounts.put(loopStepId, count);
        this.loopCounter = count;
        this.updatedAt = Instant.now();
        this.dirty = true;
    }

    /** Passes this token has made through a loop step in its current pass, or null if it never entered it. */
    public Integer loopCount(String loopStepId) {
        return loopCounts.get(loopStepId);
    }

    public Map<String, Integer> loopCounts() {
        return Map.copyOf(loopCounts);
    }

    public String id() { return id; }
    public String activityId() { return activityId; }
    public State state() { return state; }
    public String parentTokenId() { return parentTokenId; }
    public String scopeTokenId() { return scopeTokenId; }
    public int loopCounter() { return loopCounter; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public boolean isDirty() { return dirty; }
    void markClean() { dirty = false; }

    @Override
    public String toString() {
        return "ProcessToken[" + id + " " + state + " @" + activityId + "]";
    }
}
