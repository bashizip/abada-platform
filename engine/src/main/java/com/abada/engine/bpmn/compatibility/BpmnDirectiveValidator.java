package com.abada.engine.bpmn.compatibility;

import com.abada.engine.parser.assignment.AssignmentXml;
import org.w3c.dom.Attr;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Classifies known dialect directives and rejects unknown execution semantics. */
public final class BpmnDirectiveValidator {
    private static final Set<String> CAMUNDA_SUPPORTED = Set.of(
            "assignee", "candidateUsers", "candidateGroups", "class", "topic", "formKey",
            "candidateStarterGroups", "candidateStarterUsers");
    private static final Set<String> CAMUNDA_EXECUTION_RELEVANT = Set.of(
            "delegateExpression", "expression", "type", "resultVariable", "asyncBefore", "asyncAfter",
            "exclusive", "calledElementBinding", "calledElementVersion");
    private static final Set<String> ABADA_SUPPORTED_ELEMENTS = Set.of(
            "metadata", "assignment", "assignee", "candidateUsers", "candidateGroups", "user", "group",
            "decisionTable", "input", "rule", "output");

    public List<BpmnValidationIssue> validate(String xml, BpmnParseOptions options) {
        List<BpmnValidationIssue> issues = new ArrayList<>();
        AssignmentXml parsed = AssignmentXml.parse(xml);
        for (Element element : parsed.elements()) {
            if (BpmnCompatibilityDetector.ABADA_NAMESPACE.equals(element.getNamespaceURI())
                    && !ABADA_SUPPORTED_ELEMENTS.contains(element.getLocalName())) {
                issues.add(issue(BpmnErrorCodes.UNSUPPORTED_EXTENSION, ValidationSeverity.ERROR, element,
                        "Unknown Abada execution extension '" + element.getLocalName() + "'"));
            }
            NamedNodeMap attributes = element.getAttributes();
            for (int i = 0; i < attributes.getLength(); i++) {
                if (!(attributes.item(i) instanceof Attr attribute)
                        || !BpmnCompatibilityDetector.CAMUNDA_NAMESPACE.equals(attribute.getNamespaceURI())) continue;
                String name = attribute.getLocalName();
                if (CAMUNDA_SUPPORTED.contains(name)) continue;
                boolean error = options.strict() || options.rejectVendorExtensions()
                        || CAMUNDA_EXECUTION_RELEVANT.contains(name);
                issues.add(issue(BpmnErrorCodes.UNSUPPORTED_EXTENSION,
                        error ? ValidationSeverity.ERROR : ValidationSeverity.WARNING, element,
                        "Unsupported Camunda 7 directive 'camunda:" + name + "'"));
            }
        }
        return List.copyOf(issues);
    }

    private BpmnValidationIssue issue(String code, ValidationSeverity severity, Element element, String message) {
        return new BpmnValidationIssue(code, severity, message, null,
                element.hasAttribute("id") ? element.getAttribute("id") : null,
                element.getNamespaceURI(), null,
                "Remove the directive or translate it to a supported Abada construct.");
    }
}
