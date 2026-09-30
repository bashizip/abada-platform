package com.abada.engine.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.abada.engine.llm.AiProviderKeyReencryption;
import com.abada.engine.persistence.entity.AiProviderEntity;
import com.abada.engine.persistence.repository.AiProviderRepository;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class AesEncryptionTest {
    private static String newKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    @Test
    void roundTripsWithAConfiguredKey() {
        AesEncryption encryption = new AesEncryption(newKey());
        String ciphertext = encryption.encrypt("provider-key");

        assertThat(ciphertext).doesNotContain("provider-key");
        assertThat(encryption.decrypt(ciphertext)).isEqualTo("provider-key");
        assertThat(encryption.isUsingDevKey()).isFalse();
        assertThat(encryption.isLegacy(ciphertext)).isFalse();
    }

    @Test
    void valuesWrittenWithTheDevKeyStillDecryptAfterARealKeyIsSet() {
        String legacy = new AesEncryption("").encrypt("provider-key");
        AesEncryption configured = new AesEncryption(newKey());

        assertThat(configured.decrypt(legacy)).isEqualTo("provider-key");
        assertThat(configured.isLegacy(legacy)).isTrue();
    }

    @Test
    void aValueFromAnotherRealKeyIsRejected() {
        String foreign = new AesEncryption(newKey()).encrypt("provider-key");

        assertThatThrownBy(() -> new AesEncryption(newKey()).decrypt(foreign))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void startupReencryptsLegacyProviderKeysUnderTheConfiguredKey() {
        AesEncryption configured = new AesEncryption(newKey());
        AiProviderEntity row = new AiProviderEntity();
        row.setId("gemini");
        row.setApiKeyEnc(new AesEncryption("").encrypt("provider-key"));
        AiProviderRepository repository = mock(AiProviderRepository.class);
        when(repository.findAll()).thenReturn(List.of(row));
        when(repository.findById("gemini")).thenReturn(Optional.of(row));
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        new AiProviderKeyReencryption(repository, configured,
                new TransactionTemplate(mock(PlatformTransactionManager.class))).reencryptLegacyKeys();

        assertThat(configured.isLegacy(row.getApiKeyEnc())).isFalse();
        assertThat(configured.decrypt(row.getApiKeyEnc())).isEqualTo("provider-key");
        assertThatThrownBy(() -> new AesEncryption("").decrypt(row.getApiKeyEnc()))
                .as("no longer readable with the public dev key").isInstanceOf(IllegalStateException.class);
    }
}
