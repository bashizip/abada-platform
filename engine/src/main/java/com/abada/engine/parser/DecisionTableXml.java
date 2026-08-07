package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnCompatibilityDetector;
import com.abada.engine.bpmn.compatibility.BpmnErrorCodes;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableInput;
import com.abada.engine.core.model.DecisionTableMeta.DecisionTableRule;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Secure, namespace-aware extraction of the native {@code abada:decisionTable}
 * extension declared on {@code bpmn:businessRuleTask} elements.
 *
 * <pre>{@code
 * <bpmn:businessRuleTask id="tax-rules" name="Tax Rules">
 *   <bpmn:extensionElements>
 *     <abada:decisionTable decisionKey="DMN_TAX_V3" hitPolicy="FIRST">
 *       <abada:input name="Jurisdiction" expr="${order.jurisdiction}" />
 *       <abada:rule when="Jurisdiction == 'EU' &amp;&amp; OrderAmountUSD > 10000">
 *         <abada:output name="AppliedTaxRate" value="21%" />
 *       </abada:rule>
 *       <abada:rule otherwise="true">
 *         <abada:output name="AppliedTaxRate" value="15%" />
 *       </abada:rule>
 *     </abada:decisionTable>
 *   </bpmn:extensionElements>
 * </bpmn:businessRuleTask>
 * }</pre>
 */
public final class DecisionTableXml {

    private static final String NS = BpmnCompatibilityDetector.ABADA_NAMESPACE;
    private static final String BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL";
    private static final Set<String> SUPPORTED_HIT_POLICIES = Set.of("FIRST", "UNIQUE", "COLLECT");

    private final Document document;

    private DecisionTableXml(Document document) {
        this.document = document;
    }

    public static DecisionTableXml parse(String source) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            return new DecisionTableXml(factory.newDocumentBuilder().parse(
                    new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8))));
        } catch (Exception exception) {
            throw new IllegalArgumentException("BPMN XML cannot be parsed securely", exception);
        }
    }

    /** Returns the decision table declared on the given business rule task, if any. */
    public Optional<DecisionTableMeta> tableFor(String taskId, String taskName) {
        Optional<Element> task = elementById(taskId);
        if (task.isEmpty()) return Optional.empty();

        Optional<Element> extensionElements = firstChild(task.get(), BPMN, "extensionElements");
        if (extensionElements.isEmpty()) return Optional.empty();

        List<Element> tables = children(extensionElements.get(), NS, "decisionTable");
        if (tables.isEmpty()) return Optional.empty();
        if (tables.size() > 1) {
            throw validation("businessRuleTask '" + taskId
                    + "' declares more than one abada:decisionTable", taskId);
        }

        Element tableElement = tables.get(0);
        String decisionKey = attribute(tableElement, "decisionKey", taskId);
        String hitPolicy = attribute(tableElement, "hitPolicy", "FIRST").toUpperCase(java.util.Locale.ROOT);
        if (!SUPPORTED_HIT_POLICIES.contains(hitPolicy)) {
            throw validation("decision table '" + decisionKey + "' uses unsupported hitPolicy '" + hitPolicy
                    + "'; supported values are FIRST, UNIQUE, COLLECT", taskId);
        }

        List<DecisionTableInput> inputs = new ArrayList<>();
        for (Element input : children(tableElement, NS, "input")) {
            String name = input.getAttribute("name");
            if (name.isBlank()) {
                throw validation("decision table '" + decisionKey + "' has an abada:input without a name", taskId);
            }
            inputs.add(new DecisionTableInput(name, input.getAttribute("expr")));
        }

        List<Element> ruleElements = children(tableElement, NS, "rule");
        if (ruleElements.isEmpty()) {
            throw validation("decision table '" + decisionKey + "' has no abada:rule", taskId);
        }

        List<DecisionTableRule> rules = new ArrayList<>();
        int otherwiseCount = 0;
        for (Element ruleElement : ruleElements) {
            String when = ruleElement.getAttribute("when");
            boolean otherwise = Boolean.parseBoolean(ruleElement.getAttribute("otherwise"));
            if (otherwise) otherwiseCount++;
            if (when.isBlank() && !otherwise) {
                throw validation("decision table '" + decisionKey
                        + "' has a rule with neither a 'when' condition nor otherwise=\"true\"", taskId);
            }

            Map<String, Object> then = new LinkedHashMap<>();
            for (Element output : children(ruleElement, NS, "output")) {
                String name = output.getAttribute("name");
                if (name.isBlank()) {
                    throw validation("decision table '" + decisionKey + "' has an abada:output without a name",
                            taskId);
                }
                then.put(name, coerce(output.getAttribute("value")));
            }
            rules.add(new DecisionTableRule(when, otherwise, Map.copyOf(then)));
        }
        if (otherwiseCount > 1) {
            throw validation("decision table '" + decisionKey
                    + "' declares more than one otherwise rule", taskId);
        }

        return Optional.of(new DecisionTableMeta(taskId, taskName, decisionKey, hitPolicy,
                List.copyOf(inputs), List.copyOf(rules)));
    }

    /** Simple boolean/number/string coercion for output values. */
    static Object coerce(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.equalsIgnoreCase("true")) return Boolean.TRUE;
        if (value.equalsIgnoreCase("false")) return Boolean.FALSE;
        try {
            if (value.matches("-?\\d+")) return Long.parseLong(value);
            if (value.matches("-?\\d+\\.\\d+")) return Double.parseDouble(value);
        } catch (NumberFormatException ignored) {
            // fall through to string
        }
        return value;
    }

    private static BpmnValidationException validation(String message, String elementId) {
        return BpmnValidationException.single(new BpmnValidationIssue(
                BpmnErrorCodes.UNSUPPORTED_EXTENSION, ValidationSeverity.ERROR, message, null, elementId, NS,
                null, "Fix the abada:decisionTable extension and redeploy."));
    }

    private Optional<Element> elementById(String id) {
        NodeList all = document.getElementsByTagNameNS("*", "*");
        for (int i = 0; i < all.getLength(); i++) {
            Element element = (Element) all.item(i);
            if (id.equals(element.getAttribute("id"))) return Optional.of(element);
        }
        return Optional.empty();
    }

    private static Optional<Element> firstChild(Element parent, String namespace, String localName) {
        for (Node child = parent.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (child instanceof Element element && namespace.equals(element.getNamespaceURI())
                    && localName.equals(element.getLocalName())) return Optional.of(element);
        }
        return Optional.empty();
    }

    private static List<Element> children(Element parent, String namespace, String localName) {
        List<Element> result = new ArrayList<>();
        for (Node child = parent.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (child instanceof Element element && namespace.equals(element.getNamespaceURI())
                    && localName.equals(element.getLocalName())) result.add(element);
        }
        return result;
    }

    private static String attribute(Element element, String name, String fallback) {
        return element.hasAttribute(name) ? element.getAttribute(name) : fallback;
    }
}
