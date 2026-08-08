package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.PrincipalEntity;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PrincipalRepository extends JpaRepository<PrincipalEntity, String> {
    Optional<PrincipalEntity> findByIssuerAndSubjectId(String issuer, String subjectId);
    Page<PrincipalEntity> findByUsernameContainingIgnoreCase(String query, Pageable pageable);
}
