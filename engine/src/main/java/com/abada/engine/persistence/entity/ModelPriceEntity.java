package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A model price in USD per million tokens, in effect from {@code effectiveFrom} (V30). */
@Entity
@Table(name = "model_prices")
public class ModelPriceEntity {
    @Id
    @Column(length = 36)
    private String id = UUID.randomUUID().toString();
    @Column(nullable = false)
    private String model;
    @Column
    private String provider;
    @Column(name = "input_per_million", nullable = false, precision = 18, scale = 6)
    private BigDecimal inputPerMillion;
    @Column(name = "output_per_million", nullable = false, precision = 18, scale = 6)
    private BigDecimal outputPerMillion;
    @Column(name = "effective_from", nullable = false)
    private Instant effectiveFrom;
    @Column(name = "created_by", nullable = false)
    private String createdBy;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public String getId() { return id; }
    public String getModel() { return model; }
    public void setModel(String value) { model = value; }
    public String getProvider() { return provider; }
    public void setProvider(String value) { provider = value; }
    public BigDecimal getInputPerMillion() { return inputPerMillion; }
    public void setInputPerMillion(BigDecimal value) { inputPerMillion = value; }
    public BigDecimal getOutputPerMillion() { return outputPerMillion; }
    public void setOutputPerMillion(BigDecimal value) { outputPerMillion = value; }
    public Instant getEffectiveFrom() { return effectiveFrom; }
    public void setEffectiveFrom(Instant value) { effectiveFrom = value; }
    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String value) { createdBy = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
}
