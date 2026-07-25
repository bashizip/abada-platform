# Project Configuration Review

This document summarizes the findings of a configuration review conducted on the `dev` branch. It covers potential issues found in `application-dev.yaml`, `docker-compose.yml`, and the `Dockerfile`.

---

### Overall Summary

The review identified three main areas of concern, ranging from medium to critical severity. The most critical issue is a security vulnerability that exposes the development database to the local network with no password.

### Findings by Severity

#### 🔴 Critical

*   **Unsecured H2 Database Console Exposed to the Network**
    *   **Files**: `application-dev.yaml`, `docker-compose.yml`
    *   **Problem**: The `docker-compose.yml` file exposes port `5601` to the host network. The `application-dev.yaml` file enables the H2 database console on that same port and sets an **empty password** for the `sa` user.
    *   **Impact**: This is a critical vulnerability. Anyone on the local network can navigate to `http://<your-ip-address>:5601/h2-console`, log in as `sa` with no password, and gain full, unrestricted access to the development database.

#### 🟡 High

*   **Application Runs as Root User in Container**
    *   **File**: `Dockerfile`
    *   **Problem**: The application process is run by the `root` user inside the Docker container.
    *   **Impact**: This violates the principle of least privilege. A vulnerability in the application could be exploited to gain root-level control within the container, allowing an attacker to modify files, install software, or potentially try to escalate privileges further.

#### 🔵 Medium

*   **Risky Database Schema Management**
    *   **File**: `application-dev.yaml`
    *   **Problem**: `spring.jpa.hibernate.ddl-auto` is set to `update`. While convenient for development, this can be unpredictable and destructive.
    *   **Impact**: This can cause unexpected data loss or schema corruption in the development database, leading to lost time and effort.

---

### Recommendations

It is recommended to address these issues in the following order of priority:

1.  **Secure the Database Immediately**
    *   In `application-dev.yaml`, change the database password from empty to a secure default, preferably loaded from an environment variable.

        ```yaml
        # application-dev.yaml
        spring:
          datasource:
            password: ${DB_PASSWORD:your-default-dev-password}
        ```

    *   Set the `DB_PASSWORD` environment variable in your `docker-compose.yml` file.

2.  **Create a Non-Root User in Docker**
    *   Modify the `Dockerfile` to create and use a non-root user for running the application.

        ```Dockerfile
        # In Stage 2 of your Dockerfile
        FROM eclipse-temurin:21-jre-alpine

        WORKDIR /app

        # Create a non-root user and group
        RUN addgroup -S appgroup && adduser -S appuser -G appgroup

        # Copy the fat JAR from the builder stage
        COPY --from=builder /app/target/abada-engine-*.jar app.jar

        # Change ownership to the new user
        RUN chown appuser:appgroup app.jar

        # Switch to the non-root user
        USER appuser

        EXPOSE 5601
        ENTRYPOINT ["java", "-jar", "app.jar"]
        ```

3.  **Adopt a Safer Database Migration Strategy**
    *   For long-term stability, consider adding a dedicated database migration tool like [Flyway](https://flywaydb.org/) or [Liquibase](https://www.liquibase.org/) to the project. This provides precise, version-controlled management of the database schema and is a best practice for production-grade applications.
