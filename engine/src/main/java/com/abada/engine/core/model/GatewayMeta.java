package com.abada.engine.core.model;

import java.io.Serializable;

public record GatewayMeta(String id,
                          GatewayMeta.Type type,
                          String defaultFlowId) implements Serializable {

    public enum Type {
        EXCLUSIVE,
        PARALLEL,
        INCLUSIVE,
        EVENT
    }

}