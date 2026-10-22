# Labby backend — production image (Render runs this; see render.yaml at the repo root).
# Stage 1 builds the jar with the Maven wrapper; stage 2 is a plain JRE runtime.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /build
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN ./mvnw -q dependency:go-offline
COPY src src
COPY checkstyle.xml ./
RUN ./mvnw -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/target/backend-*.jar app.jar
# Render's free instance has 512 MB total. Budget every JVM memory region explicitly so
# heap + metaspace + code cache + thread stacks stay under the container limit.
# TieredStopAtLevel=1 (C1 only) cuts code-cache and CPU use and speeds up boot.
ENV JAVA_TOOL_OPTIONS="-Xmx224m -XX:MaxMetaspaceSize=150m -XX:ReservedCodeCacheSize=48m -XX:MaxDirectMemorySize=32m -Xss512k -XX:TieredStopAtLevel=1"
EXPOSE 10000
ENTRYPOINT ["java", "-jar", "app.jar"]
