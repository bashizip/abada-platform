package com.abada.engine.api;

import com.abada.engine.dto.AiConnectionTestRequest;
import com.abada.engine.dto.AiConnectionTestResult;
import com.abada.engine.dto.AiProviderDTO;
import com.abada.engine.dto.AiProviderRequest;
import com.abada.engine.dto.AiProvidersStatusDTO;
import com.abada.engine.llm.AiProviderService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Studio Settings &rarr; AI Providers. Keys are write-only: responses carry a
 * hint ({@code ****abcd}) and never the key. Saved providers take precedence
 * over environment ({@code ABADA_LLM_*}) providers of the same id and serve
 * agent tasks, Insight and APL authoring alike.
 */
@RestController
@RequestMapping("/v1/ai-providers")
public class AiProviderController {

    private final AiProviderService providers;

    public AiProviderController(AiProviderService providers) {
        this.providers = providers;
    }

    @GetMapping
    public List<AiProviderDTO> list() {
        return providers.list();
    }

    /** Whether the given agent models ({@code ?model=a&model=b}) have a configured provider. */
    @GetMapping("/status")
    public AiProvidersStatusDTO status(@RequestParam(name = "model", required = false) List<String> models) {
        return providers.status(models);
    }

    @PutMapping("/{id}")
    public AiProviderDTO save(@PathVariable String id, @RequestBody AiProviderRequest request) {
        return providers.save(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        providers.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/test")
    public AiConnectionTestResult test(@PathVariable String id,
            @RequestBody(required = false) AiConnectionTestRequest request) {
        return providers.test(id, request);
    }
}
