package com.abada.engine.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * AES-256-GCM encryption utility for sensitive data at rest.
 * The master key is supplied via the {@code ABADA_ENCRYPTION_KEY} environment
 * variable (base64-encoded 32-byte key). Without it a built-in development key
 * is used, which is not a secret. Values written with that development key
 * (every install before {@code ABADA_ENCRYPTION_KEY} was set) still decrypt
 * once a real key is configured, and {@link #isLegacy} lets callers re-encrypt them.
 */
@Component
public class AesEncryption {

    private static final Logger log = LoggerFactory.getLogger(AesEncryption.class);
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;

    private static final SecretKey DEV_KEY = devKey();

    private final SecretKey secretKey;
    private final boolean usingDevKey;

    public AesEncryption(
            @Value("${abada.encryption.key:${ABADA_ENCRYPTION_KEY:}}") String encodedKey) {
        this.usingDevKey = encodedKey == null || encodedKey.isBlank();
        this.secretKey = resolveKey(encodedKey);
    }

    /** True when no {@code ABADA_ENCRYPTION_KEY} is configured and the public development key is in use. */
    public boolean isUsingDevKey() {
        return usingDevKey;
    }

    /** True when the value only decrypts with the development key although a real key is configured. */
    public boolean isLegacy(String encodedCiphertext) {
        if (usingDevKey || encodedCiphertext == null || encodedCiphertext.isBlank()) return false;
        try {
            decryptWith(secretKey, encodedCiphertext);
            return false;
        } catch (Exception primaryFailed) {
            try {
                decryptWith(DEV_KEY, encodedCiphertext);
                return true;
            } catch (Exception legacyFailed) {
                return false;
            }
        }
    }

    /**
     * Encrypts plaintext using AES-256-GCM with a random IV.
     * Returns a Base64-encoded string containing IV + ciphertext + tag.
     */
    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.isBlank()) {
            return null;
        }
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            new SecureRandom().nextBytes(iv);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            ByteBuffer buffer = ByteBuffer.allocate(iv.length + ciphertext.length);
            buffer.put(iv);
            buffer.put(ciphertext);
            return Base64.getEncoder().encodeToString(buffer.array());
        } catch (Exception e) {
            throw new IllegalStateException("AES encryption failed", e);
        }
    }

    /**
     * Decrypts a Base64-encoded AES-256-GCM ciphertext (IV + ciphertext + tag).
     */
    public String decrypt(String encodedCiphertext) {
        if (encodedCiphertext == null || encodedCiphertext.isBlank()) {
            return null;
        }
        try {
            return decryptWith(secretKey, encodedCiphertext);
        } catch (Exception e) {
            if (!usingDevKey) {
                try {
                    return decryptWith(DEV_KEY, encodedCiphertext);
                } catch (Exception ignored) {
                    // fall through: neither key decrypts the value
                }
            }
            throw new IllegalStateException("AES decryption failed", e);
        }
    }

    private static String decryptWith(SecretKey key, String encodedCiphertext) throws Exception {
        byte[] decoded = Base64.getDecoder().decode(encodedCiphertext);
        ByteBuffer buffer = ByteBuffer.wrap(decoded);

        byte[] iv = new byte[GCM_IV_LENGTH];
        buffer.get(iv);
        byte[] ciphertext = new byte[buffer.remaining()];
        buffer.get(ciphertext);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    /**
     * Returns the last 4 characters of the decrypted value for display purposes.
     */
    public String hint(String encodedCiphertext) {
        String decrypted = decrypt(encodedCiphertext);
        if (decrypted == null || decrypted.length() < 4) {
            return "****";
        }
        return "****" + decrypted.substring(decrypted.length() - 4);
    }

    private static SecretKey devKey() {
        byte[] devKey = new byte[32];
        for (int i = 0; i < devKey.length; i++) {
            devKey[i] = (byte) (0x41 + (i % 26));
        }
        return new SecretKeySpec(devKey, "AES");
    }

    private static SecretKey resolveKey(String encodedKey) {
        if (encodedKey == null || encodedKey.isBlank()) {
            log.warn("ABADA_ENCRYPTION_KEY is not set; using dev-only default key. "
                    + "This is NOT safe for production.");
            return DEV_KEY;
        }
        byte[] keyBytes = Base64.getDecoder().decode(encodedKey.trim());
        if (keyBytes.length != 32) {
            throw new IllegalStateException(
                    "ABADA_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256), got " + keyBytes.length);
        }
        return new SecretKeySpec(keyBytes, "AES");
    }
}
