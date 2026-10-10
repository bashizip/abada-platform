package com.abada.engine.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.persistence.entity.ModelPriceEntity;
import com.abada.engine.persistence.repository.ModelPriceRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class ModelPriceServiceTest {
    private static final Instant T0 = Instant.parse("2026-11-01T00:00:00Z");

    @Test
    void thePriceInEffectAtTheCallIsUsedPreferringTheServingProvider() {
        ModelPriceRepository repository = mock(ModelPriceRepository.class);
        AiProviderRegistry providers = mock(AiProviderRegistry.class);
        when(providers.resolveForModel("m")).thenReturn(Optional.empty());
        when(repository.findByModelOrderByEffectiveFromDesc("m")).thenReturn(List.of(
                price(null, "4", "8", T0.plusSeconds(3600)),
                price(null, "1", "2", T0)));
        ModelPriceService service = new ModelPriceService(repository, providers, mock(ActivityHistoryService.class));

        assertThat(service.priceAt("m", T0.minusSeconds(1))).isEmpty();
        assertThat(service.cost("m", 1_000_000, 500_000, T0.plusSeconds(10)).usd()).isEqualByComparingTo("2.0");
        assertThat(service.cost("m", 1_000_000, 500_000, T0.plusSeconds(7200)).usd()).isEqualByComparingTo("8.0");
        assertThat(service.cost("m", null, null, T0)).isEqualTo(ModelPriceService.Cost.NONE);
        assertThat(service.cost("other", 10, 10, T0)).isEqualTo(ModelPriceService.Cost.UNPRICED);
    }

    @Test
    void aProviderSpecificPriceWinsOverAGenericOne() {
        ModelPriceRepository repository = mock(ModelPriceRepository.class);
        AiProviderRegistry providers = mock(AiProviderRegistry.class);
        ResolvedAiProvider gemini = mock(ResolvedAiProvider.class);
        when(gemini.id()).thenReturn("gemini");
        when(providers.resolveForModel("m")).thenReturn(Optional.of(gemini));
        when(repository.findByModelOrderByEffectiveFromDesc("m")).thenReturn(List.of(
                price(null, "1", "1", T0.plusSeconds(60)),
                price("gemini", "3", "3", T0)));
        ModelPriceService service = new ModelPriceService(repository, providers, mock(ActivityHistoryService.class));

        assertThat(service.priceAt("m", T0.plusSeconds(120)).orElseThrow().inputPerMillion())
                .isEqualByComparingTo("3");
    }

    private static ModelPriceEntity price(String provider, String input, String output, Instant from) {
        ModelPriceEntity row = new ModelPriceEntity();
        row.setModel("m");
        row.setProvider(provider);
        row.setInputPerMillion(new BigDecimal(input));
        row.setOutputPerMillion(new BigDecimal(output));
        row.setEffectiveFrom(from);
        return row;
    }
}
