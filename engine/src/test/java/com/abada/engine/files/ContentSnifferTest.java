package com.abada.engine.files;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The type comes from the bytes; the name only picks within a container and must agree with them. */
class ContentSnifferTest {

    private static ContentSniffer.Sniffed sniff(byte[] bytes, String name) {
        return ContentSniffer.sniff(bytes, bytes.length, name);
    }

    @Test
    void recognisesCommonBusinessFiles() {
        assertThat(sniff(ProcessFileApiTest.pdf(100), "invoice.PDF").contentType()).isEqualTo("application/pdf");
        assertThat(sniff(ProcessFileApiTest.png(), "scan.png").contentType()).isEqualTo("image/png");
        assertThat(sniff(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x00}, "photo.jpg").contentType())
                .isEqualTo("image/jpeg");
        byte[] zip = {'P', 'K', 3, 4, 0, 0};
        assertThat(sniff(zip, "contract.docx").contentType())
                .isEqualTo("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assertThat(sniff(zip, "archive.zip").contentType()).isEqualTo("application/zip");
        assertThat(sniff("a;b\n1;2\n".getBytes(StandardCharsets.UTF_8), "rows.csv").contentType()).isEqualTo("text/csv");
        assertThat(sniff("Olá, Mundo — ünïcode".getBytes(StandardCharsets.UTF_8), "note.txt").contentType())
                .isEqualTo("text/plain");
        assertThat(sniff("MZ is also a plain word".getBytes(StandardCharsets.UTF_8), "note.txt").refused()).isFalse();
        assertThat(sniff(new byte[] {1, 2, 0, 4}, "blob").contentType()).isEqualTo("application/octet-stream");
    }

    @Test
    void refusesExecutablesAndNamesThatContradictTheBytes() {
        assertThat(sniff(ProcessFileApiTest.portableExecutable(), "report.pdf").refusal()).isEqualTo("executable");
        assertThat(sniff(new byte[] {0x7F, 'E', 'L', 'F', 2}, "data.bin").refusal()).isEqualTo("executable");
        assertThat(sniff("#!/bin/sh\nrm -rf /\n".getBytes(StandardCharsets.UTF_8), "notes.txt").refusal())
                .isEqualTo("executable");
        assertThat(sniff(ProcessFileApiTest.pdf(10), "setup.exe").refusal()).isEqualTo("executable");
        assertThat(sniff(ProcessFileApiTest.png(), "invoice.pdf").refusal()).isEqualTo("type_mismatch");
        assertThat(sniff("hello".getBytes(StandardCharsets.UTF_8), "invoice.pdf").refusal()).isEqualTo("type_mismatch");
    }

    @Test
    void acceptListsMatchExtensionsTypesAndWildcards() {
        assertThat(ContentSniffer.accepted(List.of(), "application/pdf", "a.pdf")).isTrue();
        assertThat(ContentSniffer.accepted(List.of(".pdf"), "application/pdf", "A.PDF")).isTrue();
        assertThat(ContentSniffer.accepted(List.of("image/*"), "image/png", "a.png")).isTrue();
        assertThat(ContentSniffer.accepted(List.of("image/*", ".docx"), "application/pdf", "a.pdf")).isFalse();
        assertThat(ContentSniffer.accepted(List.of("application/pdf"), "application/pdf", "a.pdf")).isTrue();
    }

    @Test
    void namesAreReducedToASafeBaseName() {
        assertThat(ProcessFileService.cleanName("C:\\Users\\me\\report.pdf")).isEqualTo("report.pdf");
        assertThat(ProcessFileService.cleanName("../../etc/passwd")).isEqualTo("passwd");
        assertThat(ProcessFileService.cleanName("in\u0000voice\u202E.pdf")).isEqualTo("invoice.pdf");
    }
}
