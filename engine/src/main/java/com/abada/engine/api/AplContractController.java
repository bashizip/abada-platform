package com.abada.engine.api;

import com.abada.engine.apl.AplContractService;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The machine-readable APL contract shared by Studio, automation and authoring. */
@RestController
@RequestMapping("/v1/apl")
public class AplContractController {
    public static final MediaType SCHEMA_JSON = MediaType.parseMediaType("application/schema+json");

    public record AplValidationRequest(String source) {}
    public record AplValidationIssue(String code, String severity, String message, String path,
                                     String elementId, String suggestedResolution) {
        static AplValidationIssue from(BpmnValidationIssue issue) {
            return new AplValidationIssue(issue.code(), issue.severity().name(), issue.message(), issue.path(),
                    issue.elementId(), issue.suggestedResolution());
        }
    }
    public record AplValidationResponse(boolean valid, String processKey, List<AplValidationIssue> issues) {}

    private final AplContractService contract;

    public AplContractController(AplContractService contract) {
        this.contract = contract;
    }

    /** The APL v1 JSON Schema this engine accepts, including its allowed agent models. */
    @GetMapping(value = "/schema", produces = {"application/schema+json", MediaType.APPLICATION_JSON_VALUE})
    public ResponseEntity<String> schema(
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        var served = contract.schema();
        if (served.etag().equals(ifNoneMatch)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(served.etag()).build();
        }
        return ResponseEntity.ok().eTag(served.etag()).contentType(SCHEMA_JSON).body(served.json());
    }

    /** Validates APL exactly as deployment would, without deploying or storing anything. */
    @PostMapping(value = "/validate", consumes = MediaType.APPLICATION_JSON_VALUE)
    public AplValidationResponse validate(@RequestBody AplValidationRequest request) {
        if (request == null || request.source() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, "source is required");
        }
        var result = contract.validate(request.source());
        return new AplValidationResponse(result.valid(), result.processKey(),
                result.issues().stream().map(AplValidationIssue::from).toList());
    }
}
