package com.abada.engine.dto;

import java.util.List;
import org.springframework.data.domain.Page;

public record PageDTO<T>(List<T> items, int page, int size, long totalElements, int totalPages) {
    public static <S, T> PageDTO<T> map(Page<S> page, java.util.function.Function<S, T> mapper) {
        return new PageDTO<>(page.getContent().stream().map(mapper).toList(), page.getNumber(),
                page.getSize(), page.getTotalElements(), page.getTotalPages());
    }
}
