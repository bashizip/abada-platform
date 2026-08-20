package com.abada.engine.dto;

import java.util.List;

/**
 * Worker self-registration: the calling worker principal declares the global
 * topics it can serve and, optionally, the model identifiers it supports.
 * An empty models list means "all models in the engine allow-list".
 */
public record WorkerRegistrationRequest(List<String> topics, List<String> models) {
}