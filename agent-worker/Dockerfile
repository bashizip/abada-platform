FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /build
COPY engine/.mvn .mvn
COPY engine/mvnw mvnw
COPY sdk/java sdk/java
COPY agent-worker agent-worker
RUN ./mvnw -q -f sdk/java/pom.xml -DskipTests install \
    && ./mvnw -q -f agent-worker/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre-alpine
ENV JAVA_TOOL_OPTIONS="-Djava.net.preferIPv4Stack=true"
RUN addgroup -S abada && adduser -S -G abada abada
WORKDIR /app
COPY --from=build /build/agent-worker/target/abada-agent-worker-1.0.0-rc.4.jar /app/agent-worker.jar
USER abada
ENTRYPOINT ["java", "-jar", "/app/agent-worker.jar"]
