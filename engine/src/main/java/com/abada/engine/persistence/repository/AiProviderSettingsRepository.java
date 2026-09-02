package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.AiProviderSettingsEntity;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiProviderSettingsRepository extends JpaRepository<AiProviderSettingsEntity, String> {
    Optional<AiProviderSettingsEntity> findById(String id);
}
