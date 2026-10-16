package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** One background refresh (the price catalog, a provider's models), claimed with a short lease (V39). */
@Entity
@Table(name = "ai_refresh_state")
public class AiRefreshStateEntity {
    @Id
    @Column(length = 80)
    private String id;
    @Column(name = "refreshed_at")
    private Instant refreshedAt;
    @Column(name = "claimed_until")
    private Instant claimedUntil;
    @Column(length = 16)
    private String status;
    @Column(length = 1000)
    private String message;
    @Column(name = "item_count")
    private Integer itemCount;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public Instant getRefreshedAt() { return refreshedAt; }
    public void setRefreshedAt(Instant value) { refreshedAt = value; }
    public Instant getClaimedUntil() { return claimedUntil; }
    public void setClaimedUntil(Instant value) { claimedUntil = value; }
    public String getStatus() { return status; }
    public void setStatus(String value) { status = value; }
    public String getMessage() { return message; }
    public void setMessage(String value) { message = value; }
    public Integer getItemCount() { return itemCount; }
    public void setItemCount(Integer value) { itemCount = value; }
}
