package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ModelCatalogPriceEntity;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ModelCatalogPriceRepository extends JpaRepository<ModelCatalogPriceEntity, String> {
    List<ModelCatalogPriceEntity> findByModelKeyAndEffectiveFromLessThanEqualOrderByEffectiveFromDesc(
            String modelKey, Instant at);

    List<ModelCatalogPriceEntity> findByModelOrderByEffectiveFromDesc(String model);

    long count();
}
