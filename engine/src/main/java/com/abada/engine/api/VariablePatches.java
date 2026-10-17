package com.abada.engine.api;

import com.abada.engine.dto.VariablePatchRequest;
import com.abada.engine.dto.VariableValue;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

/** Reads the modifications of a variable patch, rejecting a malformed body as a client error. */
final class VariablePatches {
    private VariablePatches() {}

    /**
     * The variables to set, in request order. A body without {@code modifications}, with none, or with a
     * variable that has no {@code value} is a {@code 400 INVALID_REQUEST}, never an engine error.
     */
    static Map<String, Object> modifications(VariablePatchRequest request) {
        if (request == null || request.modifications() == null || request.modifications().isEmpty()) {
            throw invalid("The body needs \"modifications\": {\"<name>\": {\"value\": ...}}");
        }
        Map<String, Object> modifications = new LinkedHashMap<>();
        for (Map.Entry<String, VariableValue> entry : request.modifications().entrySet()) {
            String name = entry.getKey();
            if (name == null || name.isBlank()) throw invalid("A variable name is blank");
            if (entry.getValue() == null || entry.getValue().toObject() == null) {
                throw invalid("Variable '" + name + "' has no value");
            }
            modifications.put(name, entry.getValue().toObject());
        }
        return modifications;
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
