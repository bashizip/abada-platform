package com.abada.engine.forms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** Deploy-time rules of a task form: every type, rule and layout constraint, refused loudly. */
class FormSchemaTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void theSupplierFormWithEveryFieldTypeAndALayoutIsValid() throws Exception {
        FormSchema form = FormSchema.parse(FormConformanceTest.read("apl/forms/supplier-onboarding.json"));
        assertThat(form.fields()).hasSize(31);
        assertThat(form.fields().stream().map(FormSchema.Field::type).distinct())
                .containsExactlyInAnyOrderElementsOf(FormSchema.TYPES.stream().filter(type -> !type.equals("number"))
                        .toList());
        assertThat(form.field("vat_id").visibleWhen().identifiers()).containsExactly("vat_registered");
        assertThat(form.field("regions").options()).containsExactly("iberia", "benelux", "dach", "nordics", "france", "italy");
    }

    @Test
    void todaysFlatFormsStayValid() {
        FormSchema form = parse("""
                {"title":"Lead Review","fields":[
                  {"id":"decision","type":"select","label":"Decision","required":true,"options":["approve","reject"]},
                  {"id":"amount","type":"number","label":"Amount","placeholder":"0","defaultValue":3},
                  {"id":"notes","type":"textarea","label":"Notes"},
                  {"id":"due","type":"date","label":"Due"},{"id":"ok","type":"boolean","label":"OK"},
                  {"id":"name","type":"string","label":"Name"}]}""");
        assertThat(form.fields()).hasSize(6);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "unknown type | {'id':'a','type':'colour'} | unknown type 'colour'",
            "file is reserved | {'id':'a','type':'file'} | file fields arrive with file upload",
            "bad id | {'id':'1a','type':'string'} | must be letters, digits and _",
            "select without options | {'id':'a','type':'select'} | needs at least one option",
            "duplicate option | {'id':'a','type':'radio','options':['x','x']} | listed twice",
            "options on text | {'id':'a','type':'string','options':['x']} | 'options' only applies",
            "pattern on number | {'id':'a','type':'number','pattern':'x'} | 'pattern' only applies",
            "look-ahead pattern | {'id':'a','type':'string','pattern':'(?=x)y'} | not a portable regular expression",
            "back-reference | {'id':'a','type':'string','pattern':'(a)\\\\1'} | not a portable regular expression",
            "inline flag | {'id':'a','type':'string','pattern':'(?i)abc'} | browsers read differently",
            "min over max length | {'id':'a','type':'string','minLength':5,'maxLength':2} | minLength is larger",
            "length on date | {'id':'a','type':'date','maxLength':2} | only apply to text fields",
            "negative length | {'id':'a','type':'string','maxLength':-1} | whole number of 0 or more",
            "min over max | {'id':'a','type':'number','min':5,'max':2} | min is larger than max",
            "text min on number | {'id':'a','type':'number','min':'x'} | min must be a number",
            "bad date min | {'id':'a','type':'date','min':'01/02/2026'} | must be a date like",
            "date min after max | {'id':'a','type':'date','min':'2026-02-01','max':'2026-01-01'} | min is later than max",
            "bad currency | {'id':'a','type':'currency','currency':'EURO'} | not an ISO 4217 code",
            "required display | {'id':'a','type':'display','variable':'x','required':true} | cannot be required",
            "display without variable | {'id':'a','type':'display'} | names the process variable",
            "visible_when outside the subset | {'id':'a','type':'string','visible_when':'x.y == 1'} | visible_when",
            "visible_when on itself | {'id':'a','type':'string','visible_when':'a == 1'} | cannot depend on the field itself",
            "min on text | {'id':'a','type':'string','min':1} | min/max do not apply"
    })
    void refusesABrokenField(String name, String field, String message) {
        String json = "{\"fields\":[" + field.replace('\'', '"') + "]}";
        assertThatThrownBy(() -> parse(json)).isInstanceOf(FormSchema.InvalidFormException.class)
                .hasMessageContaining(message);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "row of five | [['a','b','c','d','e']] | a row holds 1 to 4 fields",
            "spans over four | [[{'field':'a','span':3},{'field':'b','span':2}]] | more than 4",
            "span of five | [[{'field':'a','span':5}],['b']] | span of 'a' must be 1 to 4",
            "unknown field | [['a','b','zz']] | 'zz' is not a field",
            "field placed twice | [['a','b'],['a']] | placed 2 times",
            "field not placed | [['a']] | 'b' is not placed",
            "empty row | [[],['a','b']] | a row holds 1 to 4 fields"
    })
    void refusesABrokenLayout(String name, String rows, String message) {
        String json = ("{'fields':[{'id':'a','type':'string'},{'id':'b','type':'number'}],"
                + "'layout':{'sections':[{'id':'main','rows':" + rows + "}]}}").replace('\'', '"');
        assertThatThrownBy(() -> parse(json)).isInstanceOf(FormSchema.InvalidFormException.class)
                .hasMessageContaining(message);
    }

    @Test
    void stepsCoverEverySectionOnceInOrder() {
        String base = "{'fields':[{'id':'a','type':'string'},{'id':'b','type':'string'}],'layout':{'sections':["
                + "{'id':'one','rows':[['a']]},{'id':'two','rows':[['b']]}],'steps':STEPS}}";
        assertThat(parse(base.replace("STEPS", "[{'title':'1','sections':['one']},{'title':'2','sections':['two']}]")
                .replace('\'', '"')).fields()).hasSize(2);
        assertThatThrownBy(() -> parse(base.replace("STEPS", "[{'title':'1','sections':['two','one']}]").replace('\'', '"')))
                .hasMessageContaining("in section order");
        assertThatThrownBy(() -> parse(base.replace("STEPS", "[{'title':'1','sections':['one']}]").replace('\'', '"')))
                .hasMessageContaining("exactly once");
        assertThatThrownBy(() -> parse(base.replace("STEPS", "[{'title':'1','sections':['one','three']}]").replace('\'', '"')))
                .hasMessageContaining("unknown section 'three'");
    }

    @Test
    void listsEveryProblemAndDuplicateIds() {
        assertThatThrownBy(() -> parse("{\"fields\":[{\"id\":\"a\",\"type\":\"string\"},{\"id\":\"a\",\"type\":\"number\"},"
                + "{\"id\":\"c\",\"type\":\"nope\"}]}"))
                .isInstanceOfSatisfying(FormSchema.InvalidFormException.class, invalid ->
                        assertThat(invalid.problems()).hasSize(2).anySatisfy(problem -> assertThat(problem)
                                .contains("used twice")));
        assertThatThrownBy(() -> parse("[]")).hasMessageContaining("JSON object");
        assertThatThrownBy(() -> parse("{\"title\":\"x\"}")).hasMessageContaining("'fields' must be a list");
    }

    @Test
    void aCurrencyFollowsItsIsoScale() {
        FormSchema form = parse("{\"fields\":[{\"id\":\"yen\",\"type\":\"currency\",\"currency\":\"JPY\"}]}");
        assertThatThrownBy(() -> FormSubmission.check("f", form, Map.of(), Map.of("yen", 10.5)))
                .isInstanceOfSatisfying(FormSubmission.RejectedException.class, rejected ->
                        assertThat(rejected.violations()).containsExactly(new FormSubmission.Violation("yen", "decimals")));
        assertThat(FormSubmission.check("f", form, Map.of(), Map.of("yen", 1200)).accepted()).containsEntry("yen", 1200);
    }

    @Test
    void aRequiredFieldIsSatisfiedByTheVariablesCurrentValue() {
        FormSchema form = parse("{\"fields\":[{\"id\":\"owner\",\"type\":\"string\",\"required\":true}]}");
        assertThat(FormSubmission.check("f", form, Map.of("owner", "ines"), Map.of()).accepted()).isEmpty();
        assertThatThrownBy(() -> FormSubmission.check("f", form, Map.of(), null))
                .isInstanceOf(FormSubmission.RejectedException.class);
    }

    @Test
    void aHugePatternInputRunsInLinearTime() {
        FormSchema form = parse("{\"fields\":[{\"id\":\"t\",\"type\":\"string\",\"pattern\":\"(a+)+b\"}]}");
        long started = System.nanoTime();
        assertThatThrownBy(() -> FormSubmission.check("f", form, Map.of(), Map.of("t", "a".repeat(9_000) + "c")))
                .isInstanceOf(FormSubmission.RejectedException.class);
        assertThat(System.nanoTime() - started).isLessThan(2_000_000_000L);
    }

    private static FormSchema parse(String json) {
        try {
            JsonNode node = JSON.readTree(json);
            return FormSchema.parse(node);
        } catch (java.io.IOException exception) {
            throw new IllegalArgumentException(exception);
        }
    }
}
