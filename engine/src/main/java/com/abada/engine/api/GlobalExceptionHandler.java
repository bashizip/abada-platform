package com.abada.engine.api;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.insight.InsightProposalService.InsightConflictException;
import com.abada.engine.insight.InsightProposalService.InsightNotFoundException;
import com.abada.engine.dto.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Global exception handler to catch specific application exceptions and
 * transform them into standardized, user-friendly JSON error responses.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BpmnValidationException.class)
    public ResponseEntity<ErrorResponse> handleBpmnValidation(
            BpmnValidationException ex, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiErrors.response(HttpStatus.BAD_REQUEST,
                ApiErrorCode.BPMN_VALIDATION_FAILED, "BPMN validation failed", request.getRequestURI(),
                Map.of("issues", ex.getIssues())));
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> handleApiException(ApiException ex, HttpServletRequest request) {
        return ResponseEntity.status(ex.status()).body(ApiErrors.response(ex.status(), ex.code(), ex.getMessage(),
                request.getRequestURI(), ex.details()));
    }

    /**
     * Handles known business rule violations from the process engine.
     *
     * @param ex      The caught ProcessEngineException.
     * @param request The current web request.
     * @return A ResponseEntity containing a structured error message with a 400 Bad Request status.
     */
    /** A workflow expression could not be evaluated; the command rolled back. */
    @ExceptionHandler(com.abada.engine.expression.ExpressionEvaluationException.class)
    public ResponseEntity<ErrorResponse> handleExpressionEvaluation(
            com.abada.engine.expression.ExpressionEvaluationException ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(ApiErrors.response(
                HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.EXPRESSION_EVALUATION_FAILED, ex.getMessage(),
                request));
    }

    @ExceptionHandler(ProcessEngineException.class)
    public ResponseEntity<ErrorResponse> handleProcessEngineException(ProcessEngineException ex,
            HttpServletRequest request) {
        String message = ex.getMessage() == null ? "Engine command rejected" : ex.getMessage();
        String normalizedMessage = message.toLowerCase(Locale.ROOT);
        if (normalizedMessage.contains("does not own external task lock")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiErrors.response(HttpStatus.FORBIDDEN,
                    ApiErrorCode.WORKER_LOCK_NOT_OWNED, message, request));
        }
        if (normalizedMessage.contains("external task lock has expired")) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiErrors.response(HttpStatus.CONFLICT,
                    ApiErrorCode.WORKER_LOCK_EXPIRED, message, request));
        }
        if (normalizedMessage.contains("not authorized") || normalizedMessage.contains("does not own")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiErrors.response(HttpStatus.FORBIDDEN,
                    ApiErrorCode.ACCESS_DENIED, message, request));
        }
        ApiErrorCode code = message.startsWith("Idempotency-Key")
                ? ApiErrorCode.IDEMPOTENCY_CONFLICT : ApiErrorCode.ENGINE_COMMAND_REJECTED;
        ErrorResponse errorResponse = ApiErrors.response(HttpStatus.BAD_REQUEST, code, message, request);
        return new ResponseEntity<>(errorResponse, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticConflict(
            ObjectOptimisticLockingFailureException ex, HttpServletRequest request) {
        ErrorResponse error = ApiErrors.response(HttpStatus.CONFLICT, ApiErrorCode.CONCURRENT_MODIFICATION,
                "Runtime state changed concurrently; reload it before retrying",
                request);
        return new ResponseEntity<>(error, HttpStatus.CONFLICT);
    }

    @ExceptionHandler(InsightNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleInsightNotFound(
            InsightNotFoundException ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiErrors.response(HttpStatus.NOT_FOUND,
                ApiErrorCode.RESOURCE_NOT_FOUND, ex.getMessage(), request));
    }

    @ExceptionHandler(InsightConflictException.class)
    public ResponseEntity<ErrorResponse> handleInsightConflict(
            InsightConflictException ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiErrors.response(HttpStatus.CONFLICT,
                ApiErrorCode.CONCURRENT_MODIFICATION, ex.getMessage(), request));
    }

    @ExceptionHandler({ MissingServletRequestParameterException.class, MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class, MethodArgumentNotValidException.class })
    public ResponseEntity<ErrorResponse> handleInvalidRequest(Exception ex, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiErrors.response(HttpStatus.BAD_REQUEST,
                ApiErrorCode.INVALID_REQUEST, "Request validation failed", request.getRequestURI(),
                Map.of("reason", safeReason(ex))));
    }

    private String safeReason(Exception ex) {
        if (ex instanceof MissingServletRequestParameterException missing) {
            return "Missing required parameter: " + missing.getParameterName();
        }
        if (ex instanceof MethodArgumentTypeMismatchException mismatch) {
            return "Invalid value for parameter: " + mismatch.getName();
        }
        return "Malformed or invalid request body";
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NoResourceFoundException ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiErrors.response(HttpStatus.NOT_FOUND,
                ApiErrorCode.RESOURCE_NOT_FOUND, "API resource not found", request));
    }

    @ExceptionHandler({ HttpRequestMethodNotSupportedException.class, HttpMediaTypeNotSupportedException.class })
    public ResponseEntity<ErrorResponse> handleUnsupportedRequest(Exception ex, HttpServletRequest request) {
        HttpStatus status = ex instanceof HttpRequestMethodNotSupportedException
                ? HttpStatus.METHOD_NOT_ALLOWED : HttpStatus.UNSUPPORTED_MEDIA_TYPE;
        return ResponseEntity.status(status).body(ApiErrors.response(status, ApiErrorCode.INVALID_REQUEST,
                status.getReasonPhrase(), request));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled API error method={} path={} type={}", request.getMethod(), request.getRequestURI(),
                ex.getClass().getSimpleName());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ApiErrors.response(
                HttpStatus.INTERNAL_SERVER_ERROR, ApiErrorCode.INTERNAL_ERROR,
                "The engine could not complete the request", request));
    }
}
