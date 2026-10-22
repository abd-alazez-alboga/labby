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
# Render's free instance has 512 MB; cap the heap well below it.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
