package com.abada.engine.dto;

/** A decision a reviewer can take on a human task. */
public record TaskOutcomeDto(String name, boolean commentRequired) {
}
