package com.abada.engine.dto;

import java.time.Instant;

public record InsightReviewRequest(String decision, String comment, Instant expectedUpdatedAt) {}
