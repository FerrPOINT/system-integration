FROM eclipse-temurin:25.0.5_8-jdk AS java-build
WORKDIR /work
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
COPY backend/build.gradle backend/build.gradle
COPY emulator/build.gradle emulator/build.gradle
RUN chmod +x gradlew

FROM java-build AS backend-build
COPY contracts/internal-api.openapi.yaml contracts/external-exchange.openapi.yaml contracts/
COPY backend/src backend/src
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m -XX:ActiveProcessorCount=2' :backend:bootJar

FROM java-build AS emulator-build
COPY contracts/external-exchange.openapi.yaml contracts/
COPY emulator/src emulator/src
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m -XX:ActiveProcessorCount=2' :emulator:bootJar

FROM eclipse-temurin:25.0.5_8-jre@sha256:a640968ae55027b322cedd5f8228b01a84baff0b9e9360e47601c6a111ba1699 AS runtime
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
ARG VCS_REF=development
LABEL org.opencontainers.image.revision=$VCS_REF
WORKDIR /app
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=65.0", "-XX:ActiveProcessorCount=2", "-jar", "/app/app.jar"]

FROM runtime AS backend
COPY --from=backend-build --chown=10001:10001 /work/backend/build/libs/system-integration.jar /app/app.jar

FROM runtime AS emulator
COPY --from=emulator-build --chown=10001:10001 /work/emulator/build/libs/system-integration-emulator.jar /app/app.jar
