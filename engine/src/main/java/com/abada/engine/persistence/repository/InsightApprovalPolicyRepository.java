package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.InsightApprovalPolicyEntity;
import com.abada.engine.persistence.entity.InsightApprovalPolicyId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InsightApprovalPolicyRepository
        extends JpaRepository<InsightApprovalPolicyEntity, InsightApprovalPolicyId> {}
