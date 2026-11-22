import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: infra/plans/15-next-horizon.md (Step 7, item 3); parent issue #1116.
// The sign-in flow in the Kotlin BFF template sits behind the golden-path-signin
// flag. It is on in local, the activation recorded for #1747, and off in every
// other environment overlay. Its issuer, client id and client secret come from
// environment variables supplied at run time.

const template = "templates/kotlin-bff";
/** The value golden-path-signin must hold in each environment overlay. */
const expectedSigninFlag: Record<string, boolean> = {
  local: true,
  "managed-example": false,
  vps: false,
};

async function read(path: string): Promise<string> {
  return readFile(join(await findRoot(), path), "utf8");
}

/** The value a flag holds in an overlay's features map, or undefined when the map omits it. */
function flagIn(overlay: unknown, flag: string): unknown {
  if (
    typeof overlay !== "object" ||
    overlay === null ||
    !("features" in overlay)
  ) {
    return undefined;
  }
  const features = overlay.features;
  if (typeof features !== "object" || features === null) {
    return undefined;
  }
  return Object.entries(features).find(([name]) => name === flag)?.[1];
}

async function kotlinSources(dir: string): Promise<string[]> {
  const entries = await readdir(join(await findRoot(), dir), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await kotlinSources(path)));
    } else if (entry.name.endsWith(".kt")) {
      files.push(path);
    }
  }
  return files;
}

test("golden-path-signin is declared in every environment overlay, on only in local", async () => {
  for (const [environment, expected] of Object.entries(expectedSigninFlag)) {
    const overlay: unknown = JSON.parse(
      await read(`infra/environments/${environment}/environment.yaml`),
    );
    assert.equal(
      flagIn(overlay, "golden-path-signin"),
      expected,
      `${environment} must declare golden-path-signin as ${expected}`,
    );
  }
});

test("the sign-in starters are pinned to the exact Spring Boot version, not a range", async () => {
  const script = await read(`${template}/build.gradle.kts`);
  assert.match(
    script,
    /implementation\("org\.springframework\.boot:spring-boot-starter-security:4\.1\.2"\)/,
  );
  assert.match(
    script,
    /implementation\("org\.springframework\.boot:spring-boot-starter-oauth2-client:4\.1\.2"\)/,
  );
  assert.match(
    script,
    /testImplementation\("org\.springframework\.boot:spring-boot-starter-test:4\.1\.2"\)/,
  );
  assert.doesNotMatch(script, /:(\+|latest)/);
  assert.doesNotMatch(
    script,
    /spring-boot-starter-(security|oauth2-client|test)"\)/,
  );
});

test("the README names the three environment variables and the flag that turns sign-in on", async () => {
  const readme = await read(`${template}/README.md`);
  for (const name of [
    "OIDC_ISSUER_URI",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "GOLDEN_PATH_SIGNIN",
    "golden-path-signin",
  ]) {
    assert.ok(readme.includes(name), `README must name ${name}`);
  }
});

test("the template commits no client secret, token or issuer address; the secret is read at run time", async () => {
  const properties = await read(
    `${template}/src/main/resources/application.yaml`,
  );
  assert.doesNotMatch(properties, /client-secret|client_secret|issuer-uri/);
  for (const file of await kotlinSources(`${template}/src/main/kotlin`)) {
    const source = await read(file);
    assert.doesNotMatch(source, /"https?:\/\//, file);
    assert.doesNotMatch(source, /clientSecret\s*=\s*"/, file);
  }
});

test("the sign-in code logs nothing, so no token, cookie or secret value reaches a log", async () => {
  for (const file of await kotlinSources(`${template}/src/main/kotlin`)) {
    const source = await read(file);
    assert.doesNotMatch(
      source,
      /println|Logger|LoggerFactory|\blog\.|\blogger\b/i,
      file,
    );
  }
});

test("the template ignores its Gradle build output and the Gradle cache", async () => {
  const ignore = await read(`${template}/.gitignore`);
  assert.match(ignore, /^build\/$/m);
  assert.match(ignore, /^\.gradle\/$/m);
});

test("the compatibility table records the sign-in dependency pins with their evidence", async () => {
  const table = await read("infra/catalog/compatibility.md");
  for (const pin of [
    "Spring Security (sign-in)",
    "Spring Boot OAuth2 client starter",
    "Spring Boot test starter",
  ]) {
    assert.ok(table.includes(`| ${pin}`), pin);
  }
  assert.match(table, /Spring Security \(sign-in\)\s*\|\s*7\.1\.2\s*\|/);
});
