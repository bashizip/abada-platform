package com.abada.engine.context;

import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class UserContextProvider {
    public String getUsername() {
        return IdentityContext.get()
                .map(Identity::username)
                .orElseThrow(() -> new IllegalStateException("No user in context"));
    }

    public String getPrincipalId() {
        return IdentityContext.get()
                .map(Identity::principalId)
                .orElse(null);
    }

    public List<String> getGroups() {
        return IdentityContext.get()
                .map(identity -> List.copyOf(identity.groups()))
                .orElse(List.of());
    }
}
