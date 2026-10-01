package com.abada.engine.core;

import java.time.Instant;
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
    private Instant updatedAt;
    private boolean dirty;

    private ProcessToken(String id, String activityId, State state, String parentTokenId, String scopeTokenId,
            int loopCounter, Instant createdAt, Instant updatedAt, boolean dirty) {
        this.id = id;
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
            Instant createdAt) {
        return new ProcessToken(UUID.randomUUID().toString(), activityId, state, parentTokenId, scopeTokenId, 0,
                createdAt, createdAt, true);
    }

    /** A token loaded from storage; it is not dirty until it changes. */
    public static ProcessToken restore(String id, String activityId, State state, String parentTokenId,
            String scopeTokenId, int loopCounter, Instant createdAt, Instant updatedAt) {
        return new ProcessToken(id, activityId, state, parentTokenId, scopeTokenId, loopCounter, createdAt,
                updatedAt, false);
    }

    void moveTo(String activityId, State state) {
        if (state == this.state && activityId.equals(this.activityId)) return;
        this.activityId = activityId;
        this.state = state;
        this.updatedAt = Instant.now();
        this.dirty = true;
    }

    void setLoopCounter(int loopCounter) {
        if (this.loopCounter == loopCounter) return;
        this.loopCounter = loopCounter;
        this.updatedAt = Instant.now();
        this.dirty = true;
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
