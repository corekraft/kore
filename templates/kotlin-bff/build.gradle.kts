// Golden-path Kotlin BFF template (ADR 0046): Jib builds the image on the
// pinned GraalVM JDK as a JVM, with the OpenTelemetry Java agent and a JDK AOT
// cache produced by a build-time training run.
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.time.Instant

plugins {
    id("org.jetbrains.kotlin.jvm") version "2.4.21"
    id("org.jetbrains.kotlin.plugin.spring") version "2.4.21"
    id("org.springframework.boot") version "4.1.2"
    id("com.google.cloud.tools.jib") version "3.5.4"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(platform(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES))
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("org.springframework.boot:spring-boot-starter-security:4.1.2")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-client:4.1.2")
    implementation("org.springframework.boot:spring-boot-starter-jdbc:4.1.2")
    implementation("org.springframework.boot:spring-boot-starter-session-jdbc:4.1.2")
    runtimeOnly("org.postgresql:postgresql:42.7.14")
    testImplementation("com.h2database:h2:2.4.240")
    testImplementation("org.springframework.boot:spring-boot-starter-test:4.1.2")
}

tasks.test {
    useJUnitPlatform()
}

// The 25.0.2 base on Oracle Linux 9 (ADR 0144). The default 25.0.2 image is built
// for x86-64-v3 and stops with "CPU does not support x86-64-v3" on a v2 host; the
// OL9 variant starts on both. aotTraining runs this base, so the cache is retrained
// on every build with it, in CI.
val graalvmBase =
    "ghcr.io/graalvm/jdk-community:25.0.2-ol9@sha256:3a9d4b5ef050893a6bfd683ecff0b0de3da3b89d40fda513c9acf9932dec0d9d"
val otelAgentVersion = "2.33.1"
val otelAgentSha256 =
    "e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149"

// Jib stamps every image file with this time. The JDK validates the class path
// jars' modification times against the AOT cache, so the training run sees the
// same time on the files it loads.
val imageFileTime = "1970-01-01T00:00:01Z"

fun normaliseFileTimes(dir: File) {
    val millis = Instant.parse(imageFileTime).toEpochMilli()
    dir.walkTopDown().filter { it.isFile }.forEach { it.setLastModified(millis) }
}

val otelAgentJar = layout.buildDirectory.file("agent/opentelemetry-javaagent.jar")
val imageStage = layout.buildDirectory.dir("image")

// Downloads the agent and refuses any jar whose SHA-256 is not the pinned one.
val fetchOtelAgent by tasks.registering {
    outputs.file(otelAgentJar)
    doLast {
        val target = otelAgentJar.get().asFile
        target.parentFile.mkdirs()
        val url =
            "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/" +
                "v$otelAgentVersion/opentelemetry-javaagent.jar"
        uri(url).toURL().openStream().use { input -> target.outputStream().use { input.copyTo(it) } }
        val actual =
            MessageDigest.getInstance("SHA-256").digest(target.readBytes())
                .joinToString("") { "%02x".format(it) }
        check(actual == otelAgentSha256) {
            target.delete()
            "opentelemetry-javaagent.jar $otelAgentVersion has SHA-256 $actual, expected $otelAgentSha256"
        }
    }
}

// The JDK cannot dump an AOT cache from a class path directory ("Cannot have
// non-empty directory in paths"), so the application's classes and resources go
// into one jar and the class path holds jars only.
tasks.jar {
    archiveFileName = "app.jar"
}

// Lays the application out exactly as the image has it (/app/...), so the
// training run and the container see the same class path.
val stageApp by tasks.registering(Copy::class) {
    dependsOn(tasks.jar, fetchOtelAgent)
    into(imageStage)
    from(tasks.jar) { into("app") }
    from(configurations.runtimeClasspath) { into("app/libs") }
    from(otelAgentJar) { into("app/otel") }
    doLast { normaliseFileTimes(imageStage.get().dir("app").asFile) }
}

// The training and verification runs use the same JDK image, flags and agent
// as production, with only the public application.yaml, stopped once the Spring
// context has refreshed.
val appMount = imageStage.get().dir("app").asFile
// Every jar is named, sorted: a wildcard expands in directory order, which
// differs between the bind mount and the image, and the JVM rejects a cache
// whose class path order differs from the one it was trained on.
val classPath =
    (listOf("/app/app.jar") + configurations.runtimeClasspath.get().files.map { "/app/libs/${it.name}" }.sorted())
        .joinToString(":")
val agentFlag = "-javaagent:/app/otel/opentelemetry-javaagent.jar"

fun dockerJava(vararg javaArgs: String) =
    listOf(
        "docker", "run", "--rm", "--user", "65532",
        "--volume", "$appMount:/app",
        graalvmBase,
        "java", agentFlag,
    ) + javaArgs

val aotTraining by tasks.registering(Exec::class) {
    dependsOn(stageApp)
    val aotDir = imageStage.get().dir("app/aot").asFile
    doFirst {
        aotDir.mkdirs()
        // The container runs as uid 65532 on a runner-owned mount: let it write.
        Files.setPosixFilePermissions(aotDir.toPath(), PosixFilePermissions.fromString("rwxrwxrwx"))
    }
    // The agent is attached but switched off for the dump: with its shaded classes
    // loaded, the JDK 25.0.2 AOT dump crashes (SIGSEGV in
    // SystemDictionaryShared::check_for_exclusion). aotVerify runs with it on.
    commandLine(
        dockerJava(
            "-Dotel.javaagent.enabled=false",
            "-XX:AOTCacheOutput=/app/aot/app.aot",
            "-Dspring.context.exit=onRefresh",
            "-Dotel.sdk.disabled=true",
            "-cp", classPath,
            "dev.kore.bff.ApplicationKt",
        ),
    )
}

// Proves the cache is accepted: -XX:AOTMode=on makes the JVM exit with an error
// instead of silently running without a cache that does not match.
val aotVerify by tasks.registering(Exec::class) {
    dependsOn(aotTraining)
    doFirst {
        check(File(appMount, "aot/app.aot").isFile) { "the training run wrote no AOT cache at build/image/app/aot/app.aot" }
    }
    commandLine(
        dockerJava(
            "-XX:AOTCache=/app/aot/app.aot",
            "-XX:AOTMode=on",
            "-Dspring.context.exit=onRefresh",
            "-Dotel.sdk.disabled=true",
            "-cp", classPath,
            "dev.kore.bff.ApplicationKt",
        ),
    )
}

// The application jar, the agent and the AOT cache, the layers Jib adds beside
// the dependencies.
val extraStage = layout.buildDirectory.dir("extra")
val stageExtras by tasks.registering(Copy::class) {
    dependsOn(aotVerify)
    into(extraStage)
    from(imageStage.map { it.file("app/app.jar") })
    from(imageStage.map { it.dir("app/otel") }) { into("otel") }
    from(imageStage.map { it.dir("app/aot") }) { into("aot") }
    doLast { normaliseFileTimes(extraStage.get().asFile) }
}

jib {
    from {
        image = graalvmBase
    }
    container {
        mainClass = "dev.kore.bff.ApplicationKt"
        user = "65532"
        filesModificationTime = imageFileTime
        ports = listOf("8080")
        labels.set(mapOf("org.opencontainers.image.source" to "https://github.com/corekraft/kore"))
        // The same class path the cache was trained on: a different one makes the
        // JVM reject the cache. Jib's own entrypoint would list its class
        // directories.
        entrypoint = listOf(
            "java",
            "-javaagent:/app/otel/opentelemetry-javaagent.jar",
            "-XX:AOTCache=/app/aot/app.aot",
            "-cp", classPath,
            "dev.kore.bff.ApplicationKt",
        )
    }
    extraDirectories {
        paths {
            path {
                setFrom(extraStage.get().asFile)
                into = "/app"
            }
        }
    }
}

tasks.named("jib") { dependsOn(stageExtras) }
tasks.named("jibDockerBuild") { dependsOn(stageExtras) }
