import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

async function read(path: string): Promise<string> {
  return readFile(join(await findRoot(), path), "utf8");
}

const build = "templates/kotlin-bff/build.gradle.kts";

test("the Kotlin BFF template pins its Gradle plugins to exact versions", async () => {
  const script = await read(build);
  assert.match(
    script,
    /id\("org\.jetbrains\.kotlin\.jvm"\) version "2\.4\.21"/,
  );
  assert.match(script, /id\("org\.springframework\.boot"\) version "4\.1\.2"/);
  assert.match(
    script,
    /id\("com\.google\.cloud\.tools\.jib"\) version "3\.5\.4"/,
  );
  assert.doesNotMatch(script, /version "[^"]*[+[(]|latest/);
});

test("Jib builds the BFF on the GraalVM JDK base pinned by tag and digest", async () => {
  const script = await read(build);
  assert.match(
    script,
    /val graalvmBase =\s*"ghcr\.io\/graalvm\/jdk-community:25\.0\.2@sha256:a3bdba6a313cddc89f7e1b2649140e898c68ba356994a9c317b96b01bcb9f982"/,
  );
  assert.match(script, /image = graalvmBase/);
});

test("the OpenTelemetry Java agent is pinned by exact version and checksum and verified before use", async () => {
  const script = await read(build);
  assert.match(script, /val otelAgentVersion = "2\.33\.1"/);
  assert.match(
    script,
    /val otelAgentSha256 =\s*"e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149"/,
  );
  assert.match(script, /opentelemetry-javaagent\.jar/);
  assert.match(script, /SHA-256/);
});

test("the container always starts the JVM with the agent and the build-time AOT cache", async () => {
  const script = await read(build);
  assert.match(script, /-javaagent:\/app\/otel\/opentelemetry-javaagent\.jar/);
  assert.match(script, /-XX:AOTCache=\/app\/aot\/app\.aot/);
  assert.doesNotMatch(
    script,
    /nativeCompile|native-image|org\.graalvm\.buildtools/,
  );
});

test("the AOT cache comes from a training run with the same agent that stops after the Spring context refreshes and holds no secret", async () => {
  const script = await read(build);
  assert.match(script, /-XX:AOTCacheOutput=/);
  assert.match(script, /-Dspring\.context\.exit=onRefresh/);
  assert.match(script, /extraDirectories/);
  assert.doesNotMatch(script, /password|secret|token/i);
});

test("the template image is published publicly and runs unprivileged", async () => {
  const script = await read(build);
  assert.match(
    script,
    /"org\.opencontainers\.image\.source" to "https:\/\/github\.com\/corekraft\/kore"/,
  );
  assert.match(script, /user = "65532"/);
});

test("the template has a Spring Boot entry point and a named project", async () => {
  assert.match(
    await read(
      "templates/kotlin-bff/src/main/kotlin/dev/kore/bff/Application.kt",
    ),
    /@SpringBootApplication/,
  );
  assert.match(
    await read("templates/kotlin-bff/settings.gradle.kts"),
    /rootProject\.name = "kotlin-bff"/,
  );
});

test("the release job builds, signs and verifies the Kotlin BFF template image with Jib by digest", async () => {
  const workflow = await read(".github/workflows/release.yaml");
  assert.match(
    workflow,
    /BFF_TEMPLATE_IMAGE: ghcr\.io\/corekraft\/kore\/templates\/kotlin-bff/,
  );
  assert.match(workflow, /jib --image="\$BFF_TEMPLATE_IMAGE:\$TAG"/);
  assert.match(
    workflow,
    /cosign sign --yes "\$\{BFF_TEMPLATE_IMAGE\}@\$\{BFF_TEMPLATE_DIGEST\}"/,
  );
  assert.match(
    workflow,
    /cosign verify[^\n]*\\\n[^\n]*certificate-identity "\$IDENTITY"[\s\S]*?\$\{BFF_TEMPLATE_IMAGE\}@/,
  );
});

test("the compatibility table records each Kotlin BFF template pin", async () => {
  const table = await read("infra/catalog/compatibility.md");
  for (const pin of [
    "GraalVM JDK base image",
    "OpenTelemetry Java agent",
    "Jib Gradle plugin",
  ]) {
    assert.ok(table.includes(`| ${pin}`), pin);
  }
});

test("nothing deploys the Kotlin BFF template yet", async () => {
  assert.doesNotMatch(
    await read("infra/catalog/approved-images.yaml"),
    /kotlin-bff/,
  );
  assert.doesNotMatch(await read("infra/catalog/seeds.yaml"), /kotlin-bff/);
});
