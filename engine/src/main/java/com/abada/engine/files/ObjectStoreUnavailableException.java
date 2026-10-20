package com.abada.engine.files;

/** The object store did not answer or refused the call; the message never carries a credential. */
public class ObjectStoreUnavailableException extends RuntimeException {
    public ObjectStoreUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
