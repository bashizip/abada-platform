package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.AiProviderEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiProviderRepository extends JpaRepository<AiProviderEntity, String> {
}
