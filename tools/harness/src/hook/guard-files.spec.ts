import assert from "node:assert/strict";
import { it } from "vitest";
import {
  allowed,
  bash,
  blocked,
  decide,
  edit,
  read,
  vitestConfig,
  write,
  type Result,
} from "../testing/index.js";

it("secret-path: reading key and token material is blocked", async () => {
  blocked(await read("/repo/.kore/keys/local/age.txt"), "secret-path");
  blocked(await read("/repo/.kore/state/reference-api-token"), "secret-path");
  blocked(await bash("cat .kore/keys/local/age.txt"), "secret-path");
  blocked(
    await bash("echo hi > .kore/state/reference-api-token"),
    "secret-path",
  );
  blocked(await write("/repo/.kore/keys/local/age.txt", "x"), "secret-path");
  blocked(
    await edit("/repo/.kore/state/reference-api-token", "a", "b"),
    "secret-path",
  );
});

it("secret-path: listing and unrelated state files pass", async () => {
  allowed(await bash("ls .kore/keys"));
  allowed(await read("/repo/.kore/state/local.json"));
  allowed(await read("/repo/README.md"));
});

it("sops-plaintext: writing plaintext to an encrypted path is blocked", async () => {
  const path = "/repo/infra/environments/local/secrets/db.enc.yaml";
  blocked(
    await write(path, "stringData:\n  password: hunter2\n"),
    "sops-plaintext",
  );
  blocked(await edit(path, "a", "b"), "sops-plaintext");
  blocked(
    await bash(
      "echo 'stringData: {}' > infra/environments/local/secrets/db.enc.yaml",
    ),
    "sops-plaintext",
  );
});

it("sops-plaintext: encrypted content and other paths pass", async () => {
  const path = "/repo/infra/environments/local/secrets/db.enc.yaml";
  allowed(
    await write(path, "stringData: ENC[...]\nsops:\n  version: 3.13.3\n"),
  );
  allowed(await write("/repo/infra/environments/local/values.yaml", "a: b\n"));
});

it("coverage-threshold: lowering a threshold is blocked", async () => {
  const path = "/repo/tools/kore/vitest.config.ts";
  blocked(
    await edit(path, "statements: 95", "statements: 90"),
    "coverage-threshold",
  );
  blocked(
    await write(path, vitestConfig.replace("lines: 95", "lines: 80")),
    "coverage-threshold",
  );
});

it("coverage-threshold: keeping or raising a threshold passes", async () => {
  const path = "/repo/tools/kore/vitest.config.ts";
  allowed(await edit(path, "statements: 95", "statements: 96"));
  allowed(await write(path, vitestConfig));
  allowed(await edit(path, 'include: ["a"]', 'include: ["b"]'));
});

it("image-digest: tag-pinned images warn instead of blocking", async () => {
  const result = await write(
    "/repo/apps/web/deployment.yaml",
    "image: ghcr.io/x/web:1.2.3\n",
  );
  assert.equal(result.action, "warn");
  assert.equal(result.rule, "image-digest");
});

it("image-digest: digest-pinned images and bootstrap charts pass", async () => {
  allowed(
    await write(
      "/repo/apps/web/deployment.yaml",
      `image: ghcr.io/x/web@sha256:${"a".repeat(64)}\n`,
    ),
  );
  allowed(
    await write(
      "/repo/infra/charts/oci-registry/values.yaml",
      "image: registry:3.0.0\n",
    ),
  );
});

it("unrelated tools and empty input pass", async () => {
  allowed(await decide({ tool_name: "Glob", tool_input: { pattern: "*" } }));
  allowed(await decide({}));
});

const IDEA_FILE = "docs/ideas/0001-a.md";

const outcomeWarned = (result: Result, label: string) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "idea-outcome", label);
  assert.match(result.message, /\[guard:idea-outcome\]/, label);
  assert.match(
    result.message,
    /harness outcome record/,
    `${label}: names the tool that owns the outcome`,
  );
  assert.match(result.message, /Instead/, `${label}: offers the fix`);
};

it("idea-outcome: hand-written outcome sections or fields in an idea warn, naming the outcome tool", async () => {
  outcomeWarned(
    await write(
      `/repo/${IDEA_FILE}`,
      "---\nstatus: closed\noutcome: refuted\n---\n",
    ),
    "Write outcome field",
  );
  outcomeWarned(
    await edit(`/repo/${IDEA_FILE}`, "x", "## Outcome\n\nIt worked.\n"),
    "Edit heading",
  );
  outcomeWarned(
    await edit(`/repo/${IDEA_FILE}`, "x", "### outcome\n"),
    "Edit lowercase sub-heading",
  );
});

it("idea-outcome: other idea edits and other files are not warned", async () => {
  for (const result of [
    await edit(`/repo/${IDEA_FILE}`, "a", "## Expected outcome\n"),
    await write(`/repo/${IDEA_FILE}`, "---\nexpected-outcome: faster\n---\n"),
    await write("/repo/docs/guides/x.md", "## Outcome\n"),
    await read(`/repo/${IDEA_FILE}`),
  ]) {
    assert.equal(result.action, "allow", JSON.stringify(result));
  }
});

const OVERLAY_FILE = "infra/environments/local/environment.yaml";
const flagWarned = (result: Result, label: string) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "flag-activation", label);
  assert.match(result.message, /\[guard:flag-activation\]/, label);
  assert.match(result.message, /harness flag activate/, label);
  assert.match(result.message, /Instead/, label);
};

it("flag-activation: turning a flag on in an overlay by hand warns, naming the activation tool", async () => {
  flagWarned(
    await edit(
      `/repo/${OVERLAY_FILE}`,
      '"features": { "ingress-agentgateway": false }',
      '"features": { "ingress-agentgateway": true }',
    ),
    "Edit false to true",
  );
  flagWarned(
    await edit(`/repo/${OVERLAY_FILE}`, "x", '"features": {\n  "a-b": true\n}'),
    "Edit multi-line features",
  );
  flagWarned(
    await write(
      `/repo/${OVERLAY_FILE}`,
      '{ "name": "local", "features": { "ingress-agentgateway": true } }',
    ),
    "Write a features map with a flag on",
  );
});

it("flag-activation: leaving flags off, other booleans and other files are not warned", async () => {
  for (const result of [
    await edit(`/repo/${OVERLAY_FILE}`, "a", '"features": { "x": false }'),
    await edit(`/repo/${OVERLAY_FILE}`, "a", '"other": { "enabled": true }'),
    await write(`/repo/${OVERLAY_FILE}`, '{ "name": "local", "features": {} }'),
    await write("/repo/docs/guides/x.md", '"features": { "x": true }'),
    await read(`/repo/${OVERLAY_FILE}`),
  ]) {
    assert.equal(result.action, "allow", JSON.stringify(result));
  }
});

it("flag-activation: an image tag in the same edit is reported too, not hidden", async () => {
  const result = await edit(
    `/repo/${OVERLAY_FILE}`,
    '"features": { "a-b": false }',
    '"features": { "a-b": true }, "image": "registry/app:latest"\n  image: registry/app:latest',
  );
  assert.equal(result.action, "warn");
  assert.match(result.message, /guard:flag-activation/);
  assert.match(result.message, /guard:image-digest/);
});
