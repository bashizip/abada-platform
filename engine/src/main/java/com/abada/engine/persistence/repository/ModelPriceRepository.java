package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ModelPriceEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ModelPriceRepository extends JpaRepository<ModelPriceEntity, String> {
    List<ModelPriceEntity> findByModelOrderByEffectiveFromDesc(String model);

    List<ModelPriceEntity> findAllByOrderByModelAscEffectiveFromDesc();
}
