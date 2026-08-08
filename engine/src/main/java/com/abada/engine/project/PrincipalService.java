package com.abada.engine.project;

import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PrincipalService {
    private final PrincipalRepository principals;

    public PrincipalService(PrincipalRepository principals) {
        this.principals = principals;
    }

    @Transactional
    public PrincipalEntity observe(String issuer, String subject, String username,
            PrincipalEntity.Type type) {
        Instant now = Instant.now();
        PrincipalEntity principal = principals.findByIssuerAndSubjectId(issuer, subject)
                .orElseGet(PrincipalEntity::new);
        if (principal.getFirstSeenAt() == null) principal.setFirstSeenAt(now);
        principal.setIssuer(issuer);
        principal.setSubjectId(subject);
        principal.setUsername(username);
        principal.setPrincipalType(type);
        principal.setLastSeenAt(now);
        return principals.save(principal);
    }
}
