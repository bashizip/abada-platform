package com.abada.engine.files;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Decides a file's content type from its first bytes, never from what the
 * client claims. The name's extension only chooses between types that share a
 * container (a ZIP is a .docx or a .xlsx; text is .csv or .json) and must not
 * contradict the bytes: a PNG named {@code .pdf} is refused. Executables and
 * scripts are always refused.
 */
public final class ContentSniffer {
    /** How many leading bytes the sniffer reads. */
    public static final int HEAD = 8192;

    /** The outcome: a content type, or the reason the file is refused. */
    public record Sniffed(String contentType, String refusal) {
        public boolean refused() {
            return refusal != null;
        }
    }

    private static final Map<String, String> BY_EXTENSION = Map.ofEntries(
            Map.entry("pdf", "application/pdf"),
            Map.entry("png", "image/png"),
            Map.entry("jpg", "image/jpeg"),
            Map.entry("jpeg", "image/jpeg"),
            Map.entry("gif", "image/gif"),
            Map.entry("webp", "image/webp"),
            Map.entry("tif", "image/tiff"),
            Map.entry("tiff", "image/tiff"),
            Map.entry("svg", "image/svg+xml"),
            Map.entry("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            Map.entry("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            Map.entry("odt", "application/vnd.oasis.opendocument.text"),
            Map.entry("ods", "application/vnd.oasis.opendocument.spreadsheet"),
            Map.entry("odp", "application/vnd.oasis.opendocument.presentation"),
            Map.entry("zip", "application/zip"),
            Map.entry("doc", "application/msword"),
            Map.entry("xls", "application/vnd.ms-excel"),
            Map.entry("ppt", "application/vnd.ms-powerpoint"),
            Map.entry("txt", "text/plain"),
            Map.entry("log", "text/plain"),
            Map.entry("csv", "text/csv"),
            Map.entry("tsv", "text/tab-separated-values"),
            Map.entry("md", "text/markdown"),
            Map.entry("json", "application/json"),
            Map.entry("xml", "application/xml"),
            Map.entry("html", "text/html"),
            Map.entry("htm", "text/html"));
    private static final List<String> ZIP_TYPES = List.of("docx", "xlsx", "pptx", "odt", "ods", "odp", "zip");
    private static final List<String> OLE_TYPES = List.of("doc", "xls", "ppt");
    private static final List<String> TEXT_TYPES = List.of("txt", "log", "csv", "tsv", "md", "json", "xml",
            "html", "htm", "svg");
    private static final List<String> EXECUTABLE_EXTENSIONS = List.of("exe", "dll", "com", "bat", "cmd", "msi",
            "scr", "ps1", "vbs", "sh", "jar", "app", "dmg", "so", "dylib", "bin");

    private ContentSniffer() {
    }

    public static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 || dot == name.length() - 1 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    public static Sniffed sniff(byte[] head, int length, String name) {
        String extension = extension(name);
        if (EXECUTABLE_EXTENSIONS.contains(extension)) return new Sniffed(null, "executable");
        if (executable(head, length)) return new Sniffed(null, "executable");
        String type = magic(head, length, extension);
        if (type == null) {
            type = text(head, length) ? textType(extension) : "application/octet-stream";
        }
        String expected = BY_EXTENSION.get(extension);
        if (expected != null && !expected.equals(type)) return new Sniffed(type, "type_mismatch");
        return new Sniffed(type, null);
    }

    /** Whether a sniffed type and name satisfy a field's {@code accept} list (empty accepts anything). */
    public static boolean accepted(List<String> accept, String contentType, String name) {
        if (accept == null || accept.isEmpty()) return true;
        String extension = extension(name);
        for (String entry : accept) {
            String rule = entry.strip().toLowerCase(Locale.ROOT);
            if (rule.startsWith(".")) {
                if (rule.substring(1).equals(extension)) return true;
            } else if (rule.endsWith("/*")) {
                if (contentType.startsWith(rule.substring(0, rule.length() - 1))) return true;
            } else if (rule.equals(contentType)) {
                return true;
            }
        }
        return false;
    }

    private static boolean executable(byte[] b, int n) {
        return portableExecutable(b, n)
                || starts(b, n, 0x7F, 'E', 'L', 'F')
                || starts(b, n, 0xFE, 0xED, 0xFA, 0xCE) || starts(b, n, 0xFE, 0xED, 0xFA, 0xCF)
                || starts(b, n, 0xCE, 0xFA, 0xED, 0xFE) || starts(b, n, 0xCF, 0xFA, 0xED, 0xFE)
                || starts(b, n, 0xCA, 0xFE, 0xBA, 0xBE)
                || starts(b, n, '#', '!');
    }

    /** "MZ" followed by a PE header where the DOS stub says; plain text may start with "MZ". */
    private static boolean portableExecutable(byte[] b, int n) {
        if (!starts(b, n, 'M', 'Z') || n < 0x40) return false;
        int offset = (b[0x3C] & 0xFF) | (b[0x3D] & 0xFF) << 8 | (b[0x3E] & 0xFF) << 16 | (b[0x3F] & 0xFF) << 24;
        if (offset < 0x40 || offset > n - 4) return n >= 0x40 && !text(b, n);
        return b[offset] == 'P' && b[offset + 1] == 'E' && b[offset + 2] == 0 && b[offset + 3] == 0;
    }

    private static String magic(byte[] b, int n, String extension) {
        if (starts(b, n, '%', 'P', 'D', 'F', '-')) return "application/pdf";
        if (starts(b, n, 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A)) return "image/png";
        if (starts(b, n, 0xFF, 0xD8, 0xFF)) return "image/jpeg";
        if (starts(b, n, 'G', 'I', 'F', '8', '7', 'a') || starts(b, n, 'G', 'I', 'F', '8', '9', 'a')) return "image/gif";
        if (starts(b, n, 'R', 'I', 'F', 'F') && n >= 12 && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        if (starts(b, n, 'I', 'I', '*', 0) || starts(b, n, 'M', 'M', 0, '*')) return "image/tiff";
        if (starts(b, n, 'P', 'K', 3, 4) || starts(b, n, 'P', 'K', 5, 6)) {
            return ZIP_TYPES.contains(extension) ? BY_EXTENSION.get(extension) : "application/zip";
        }
        if (starts(b, n, 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)) {
            return OLE_TYPES.contains(extension) ? BY_EXTENSION.get(extension) : "application/x-ole-storage";
        }
        return null;
    }

    private static String textType(String extension) {
        if (extension.equals("svg")) return "image/svg+xml";
        return TEXT_TYPES.contains(extension) ? BY_EXTENSION.get(extension) : "text/plain";
    }

    /** UTF-8 without NUL bytes; a multi-byte sequence cut by the end of the head is allowed. */
    private static boolean text(byte[] b, int n) {
        for (int i = 0; i < n; i++) if (b[i] == 0) return false;
        int end = n;
        int back = 0;
        while (end > 0 && back < 3 && (b[end - 1] & 0xC0) == 0x80) {
            end--;
            back++;
        }
        if (end > 0 && (b[end - 1] & 0xC0) == 0xC0) end--;
        else end = n;
        try {
            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b, 0, end));
            return true;
        } catch (CharacterCodingException exception) {
            return false;
        }
    }

    private static boolean starts(byte[] b, int n, int... prefix) {
        if (n < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) if ((b[i] & 0xFF) != prefix[i]) return false;
        return true;
    }
}
