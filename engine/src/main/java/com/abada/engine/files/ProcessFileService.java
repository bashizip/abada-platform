package com.abada.engine.files;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.forms.FormSchema;
import com.abada.engine.forms.FormSubmission;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProcessFileEntity.State;
import com.abada.engine.persistence.repository.ProcessFileRepository;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.SequenceInputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Process files (S9): upload, attachment in the completion transaction, and
 * the rules on who may read one. Bytes go to the {@link ObjectStore}; this
 * service writes only metadata to PostgreSQL. No object-store call is made
 * inside a transaction: an upload stores the object first and then inserts the
 * {@code PENDING} row; attaching changes metadata only.
 *
 * <p>Logs and history carry file ids, sizes and content types, never a file's
 * name or contents.
 */
@Service
public class ProcessFileService {
    private static final Logger log = LoggerFactory.getLogger(ProcessFileService.class);
    public static final int MAX_NAME_LENGTH = 255;

    private final ProcessFileRepository files;
    private final ObjectStore store;
    private final FilesProperties properties;
    private final ActivityHistoryService history;
    private final TransactionTemplate transactions;

    public ProcessFileService(ProcessFileRepository files, ObjectStore store, FilesProperties properties,
            ActivityHistoryService history, TransactionTemplate transactions) {
        this.files = files;
        this.store = store;
        this.properties = properties;
        this.history = history;
        this.transactions = transactions;
    }

    /** Where an upload goes: a file field of an open task the uploader may complete. */
    public record UploadTarget(String projectId, String processDefinitionId, String instanceId, String taskId,
            String activityId, String user, FormSchema.Field field) {
    }

    /** What the engine says about a file; the variable holds the same reference. */
    public record FileView(String fileId, String name, String contentType, long size, String sha256, String state,
            Instant createdAt) {
        public static FileView of(ProcessFileEntity row) {
            return new FileView(row.getId(), row.getName(), row.getContentType(), row.getSizeBytes(), row.getSha256(),
                    row.getState().name(), row.getCreatedAt());
        }
    }

    /** The reference a process variable stores for an attached file: never the bytes. */
    public static Map<String, Object> reference(ProcessFileEntity row) {
        Map<String, Object> reference = new LinkedHashMap<>();
        reference.put("fileId", row.getId());
        reference.put("name", row.getName());
        reference.put("contentType", row.getContentType());
        reference.put("size", row.getSizeBytes());
        reference.put("sha256", row.getSha256());
        return reference;
    }

    /**
     * Streams an upload to the object store while computing its size and
     * sha256, after sniffing its type from the first bytes, then records it as
     * {@code PENDING}. Refused before anything is stored when the name, size or
     * type breaks the field's rules or the engine's caps.
     */
    public FileView upload(UploadTarget target, String rawName, long length, InputStream body) {
        String name = cleanName(rawName);
        FormSchema.Field field = target.field();
        long fieldCap = field.maxSize() == null ? properties.maxFileBytes()
                : Math.min(field.maxSize(), properties.maxFileBytes());
        if (length <= 0) throw rejected(HttpStatus.BAD_REQUEST, "empty", "The file is empty or its length is unknown");
        if (length > fieldCap) {
            throw rejected(HttpStatus.PAYLOAD_TOO_LARGE, "size", "The file is larger than " + fieldCap + " bytes");
        }
        long pending = files.sumSize(target.taskId(), target.user(), State.PENDING);
        if (pending + length > properties.maxTaskBytes()) {
            throw rejected(HttpStatus.PAYLOAD_TOO_LARGE, "task_total",
                    "The files of this task would exceed " + properties.maxTaskBytes() + " bytes");
        }

        byte[] head;
        try {
            head = body.readNBytes((int) Math.min(ContentSniffer.HEAD, length));
        } catch (IOException exception) {
            throw rejected(HttpStatus.BAD_REQUEST, "read", "The upload could not be read");
        }
        ContentSniffer.Sniffed sniffed = ContentSniffer.sniff(head, head.length, name);
        if (sniffed.refused()) {
            throw rejected(HttpStatus.UNSUPPORTED_MEDIA_TYPE, sniffed.refusal(), sniffed.refusal().equals("executable")
                    ? "Executable files are not accepted" : "The file's contents do not match its name");
        }
        if (!ContentSniffer.accepted(field.accept(), sniffed.contentType(), name)) {
            throw rejected(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "accept",
                    "This field accepts " + String.join(", ", field.accept()));
        }

        String fileId = UUID.randomUUID().toString();
        String key = target.projectId() + "/" + fileId;
        MessageDigest digest = sha256();
        CountingInputStream counted = new CountingInputStream(new DigestInputStream(
                new SequenceInputStream(new ByteArrayInputStream(head), body), digest));
        try {
            store.put(key, counted, length, sniffed.contentType());
        } catch (ObjectStoreUnavailableException exception) {
            if (counted.ended() && counted.count() < length) {
                throw rejected(HttpStatus.BAD_REQUEST, "length", "The upload ended before its declared length");
            }
            log.warn("file_upload_store_failed task={} field={} reason={}", target.taskId(), field.id(),
                    exception.getMessage());
            throw unavailable();
        }
        if (counted.count() != length) {
            bestEffortDelete(key);
            throw rejected(HttpStatus.BAD_REQUEST, "length", "The upload ended before its declared length");
        }

        ProcessFileEntity row = new ProcessFileEntity();
        row.setId(fileId);
        row.setProjectId(target.projectId());
        row.setUploadedBy(target.user());
        row.setContentType(sniffed.contentType());
        row.setSizeBytes(length);
        row.setSha256(HexFormat.of().formatHex(digest.digest()));
        row.setName(name);
        row.setObjectKey(key);
        row.setState(State.PENDING);
        row.setInstanceId(target.instanceId());
        row.setTaskId(target.taskId());
        row.setFieldId(field.id());
        row.setCreatedAt(Instant.now());
        try {
            transactions.executeWithoutResult(status -> {
                files.save(row);
                history.record("FILE_UPLOADED", target.instanceId(), target.processDefinitionId(),
                        target.activityId(), details(row, null));
            });
        } catch (RuntimeException exception) {
            // The object has no row: delete it now, or the orphan sweep will.
            bestEffortDelete(key);
            throw exception;
        }
        log.info("file_uploaded file={} task={} field={} size={} type={}", fileId, target.taskId(), field.id(),
                length, sniffed.contentType());
        return FileView.of(row);
    }

    /**
     * Attaches the files a completion submits, in the completion transaction:
     * each id must be a {@code PENDING} file of this task and field, uploaded
     * by the completing user, within the field's rules and the task's cap.
     * Metadata only; nothing here calls the object store. Returns the values to
     * write (the references); throws {@link FormSubmission.RejectedException}
     * with one violation per refused field, which rolls the completion back.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Map<String, Object> attach(String formKey, FormSchema form, String instanceId, String processDefinitionId,
            String taskId, String activityId, String user, Map<String, Object> accepted) {
        Map<String, Object> written = new LinkedHashMap<>(accepted);
        List<FormSubmission.Violation> violations = new ArrayList<>();
        List<ProcessFileEntity> attached = new ArrayList<>();
        long total = 0;
        for (FormSchema.Field field : form.fields()) {
            if (!field.type().equals("file") || !accepted.containsKey(field.id())) continue;
            Object value = accepted.get(field.id());
            List<String> ids = ids(value);
            if (ids.isEmpty()) continue;
            Map<String, ProcessFileEntity> rows = new LinkedHashMap<>();
            files.lockByIds(ids).forEach(row -> rows.put(row.getId(), row));
            String rule = null;
            List<Map<String, Object>> references = new ArrayList<>();
            for (String id : ids) {
                ProcessFileEntity row = rows.get(id);
                if (row == null || !taskId.equals(row.getTaskId()) || !field.id().equals(row.getFieldId())
                        || !user.equals(row.getUploadedBy())) {
                    rule = "file_unknown";
                    break;
                }
                if (row.getState() != State.PENDING) {
                    rule = "file_not_pending";
                    break;
                }
                long cap = field.maxSize() == null ? properties.maxFileBytes()
                        : Math.min(field.maxSize(), properties.maxFileBytes());
                if (row.getSizeBytes() > cap) {
                    rule = "file_size";
                    break;
                }
                if (!ContentSniffer.accepted(field.accept(), row.getContentType(), row.getName())) {
                    rule = "file_type";
                    break;
                }
                total += row.getSizeBytes();
                references.add(reference(row));
            }
            if (rule != null) {
                violations.add(new FormSubmission.Violation(field.id(), rule));
                continue;
            }
            Instant now = Instant.now();
            for (String id : ids) {
                ProcessFileEntity row = rows.get(id);
                row.setState(State.ATTACHED);
                row.setAttachedAt(now);
                attached.add(row);
            }
            written.put(field.id(), field.multipleFiles() ? references : references.getFirst());
        }
        if (violations.isEmpty() && total > properties.maxTaskBytes()) {
            violations.add(new FormSubmission.Violation(attached.getFirst().getFieldId(), "file_total"));
        }
        if (!violations.isEmpty()) throw new FormSubmission.RejectedException(formKey, violations);
        files.saveAll(attached);
        for (ProcessFileEntity row : attached) {
            history.record("FILE_ATTACHED", instanceId, processDefinitionId, activityId, details(row, null));
        }
        return written;
    }

    /**
     * Opens a file for its reader. The caller has already decided who may read
     * it ({@link #requireReadable}). Records {@code FILE_DOWNLOADED} first, so
     * every read that may succeed is audited.
     */
    public ObjectStore.StoredObject openForRead(ProcessFileEntity row, String via) {
        transactions.executeWithoutResult(status -> history.record("FILE_DOWNLOADED", row.getInstanceId(), null,
                null, details(row, via)));
        try {
            return store.open(row.getObjectKey());
        } catch (ObjectStore.ObjectNotFoundException exception) {
            log.warn("file_unavailable file={} (object missing from the store)", row.getId());
            throw new ApiException(HttpStatus.GONE, ApiErrorCode.FILE_UNAVAILABLE,
                    "The file's contents are not available", Map.of("fileId", row.getId()));
        } catch (ObjectStoreUnavailableException exception) {
            log.warn("file_read_store_failed file={} reason={}", row.getId(), exception.getMessage());
            throw unavailable();
        }
    }

    /** A file of the project, or 404; {@code DELETING} files are already gone for readers. */
    @Transactional(readOnly = true)
    public ProcessFileEntity require(String projectId, String fileId) {
        ProcessFileEntity row = files.findById(fileId).orElse(null);
        if (row == null || !row.getProjectId().equals(projectId) || row.getState() == State.DELETING) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "File not found");
        }
        return row;
    }

    /**
     * Who may read a file: its uploader while it is {@code PENDING}; once
     * attached, {@code readers} decides (instance readers of the project and
     * the users of the instance's tasks). Anyone else gets 404, so a file's
     * existence does not leak.
     */
    public ProcessFileEntity requireReadable(String projectId, String fileId, String user,
            java.util.function.Predicate<ProcessFileEntity> readers) {
        ProcessFileEntity row = require(projectId, fileId);
        boolean uploader = user != null && user.equals(row.getUploadedBy());
        if (row.getState() == State.PENDING ? uploader : (uploader || readers.test(row))) return row;
        throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "File not found");
    }

    /** Removes a file its uploader has not submitted yet; the sweep deletes the object. */
    @Transactional
    public void discard(String projectId, String fileId, String user) {
        ProcessFileEntity row = files.findById(fileId).orElse(null);
        if (row == null || !row.getProjectId().equals(projectId) || !user.equals(row.getUploadedBy())
                || row.getState() == State.DELETING) {
            throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, "File not found");
        }
        if (row.getState() != State.PENDING) {
            throw new ApiException(HttpStatus.CONFLICT, ApiErrorCode.ENGINE_COMMAND_REJECTED,
                    "An attached file belongs to the process and cannot be removed");
        }
        row.setState(State.DELETING);
        row.setDeletingReason("discarded");
        files.save(row);
        history.record("FILE_DISCARDED", row.getInstanceId(), null, null, details(row, null));
    }

    static Map<String, Object> details(ProcessFileEntity row, String via) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("fileId", row.getId());
        details.put("taskId", row.getTaskId());
        details.put("field", row.getFieldId());
        details.put("contentType", row.getContentType());
        details.put("size", row.getSizeBytes());
        if (via != null) details.put("via", via);
        return details;
    }

    /** The ids a submitted value names (validated by {@link FormSubmission}). */
    private static List<String> ids(Object value) {
        if (value instanceof String id) return List.of(id);
        if (value instanceof Collection<?> items) return items.stream().map(String::valueOf).toList();
        return List.of();
    }

    /** The base name only, NFC, without control characters or path separators. */
    static String cleanName(String raw) {
        String name = raw == null ? "" : Normalizer.normalize(raw, Normalizer.Form.NFC);
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) name = name.substring(slash + 1);
        StringBuilder clean = new StringBuilder();
        name.codePoints().filter(cp -> !Character.isISOControl(cp) && cp != 0x7F
                && Character.getType(cp) != Character.FORMAT).forEach(clean::appendCodePoint);
        String result = clean.toString().strip();
        if (result.isEmpty() || result.equals(".") || result.equals("..")) {
            throw rejected(HttpStatus.BAD_REQUEST, "name", "The file needs a name");
        }
        if (result.codePointCount(0, result.length()) > MAX_NAME_LENGTH) {
            throw rejected(HttpStatus.BAD_REQUEST, "name", "The file name is longer than " + MAX_NAME_LENGTH);
        }
        return result;
    }

    private void bestEffortDelete(String key) {
        try {
            store.delete(key);
        } catch (RuntimeException exception) {
            log.warn("file_cleanup_deferred reason={}", exception.getMessage());
        }
    }

    static ApiException rejected(HttpStatus status, String reason, String message) {
        return new ApiException(status, ApiErrorCode.FILE_REJECTED, message, Map.of("reason", reason));
    }

    static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ApiErrorCode.OBJECT_STORE_UNAVAILABLE,
                "File storage is unavailable; try again later");
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    /** Counts the bytes the store actually read. */
    static final class CountingInputStream extends FilterInputStream {
        private long count;
        private boolean ended;

        CountingInputStream(InputStream in) {
            super(in);
        }

        long count() {
            return count;
        }

        boolean ended() {
            return ended;
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0) count++;
            else ended = true;
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int n = super.read(buffer, offset, length);
            if (n > 0) count += n;
            else if (n < 0) ended = true;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long skipped = super.skip(n);
            count += skipped;
            return skipped;
        }
    }
}
