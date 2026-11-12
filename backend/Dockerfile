FROM eclipse-temurin:25.0.5_8-jdk AS build
WORKDIR /work
COPY contracts contracts
COPY backend backend
WORKDIR /work/backend
RUN chmod +x gradlew
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m -XX:ActiveProcessorCount=2' :bootJar :emulator:bootJar

FROM eclipse-temurin:25.0.5_8-jre AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
ARG VCS_REF=development
LABEL org.opencontainers.image.revision=$VCS_REF
WORKDIR /app
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=65.0", "-XX:ActiveProcessorCount=2", "-jar", "/app/app.jar"]

FROM runtime AS backend
COPY --from=build --chown=10001:10001 /work/backend/build/libs/system-integration.jar /app/app.jar

FROM runtime AS emulator
COPY --from=build --chown=10001:10001 /work/backend/emulator/build/libs/system-integration-emulator.jar /app/app.jar
