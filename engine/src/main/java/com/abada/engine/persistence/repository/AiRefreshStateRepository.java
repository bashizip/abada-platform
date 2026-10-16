package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.AiRefreshStateEntity;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AiRefreshStateRepository extends JpaRepository<AiRefreshStateEntity, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from AiRefreshStateEntity s where s.id = :id")
    Optional<AiRefreshStateEntity> lockById(@Param("id") String id);
}
