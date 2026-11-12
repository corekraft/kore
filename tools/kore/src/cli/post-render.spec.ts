import assert from "node:assert/strict";
import { test } from "vitest";
import { postRender } from "./post-render.js";

const manifest = `kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
      - name: app
        livenessProbe:
          httpGet:
            path: /h
`;
const patches = JSON.stringify([
  {
    target: { kind: "Deployment", name: "web", container: "app" },
    reason: "r",
    probes: { livenessProbe: { timeoutSeconds: 5 } },
  },
]);

test("the post-renderer applies the patch argument to the manifest stream", () => {
  assert.match(
    postRender(manifest, [patches]),
    /path: \/h\n {10}timeoutSeconds: 5/,
  );
});

test("the post-renderer fails when a target is missing, so a chart bump cannot drop a patch", () => {
  assert.throws(
    () => postRender("kind: Service\nmetadata:\n  name: x\n", [patches]),
    /patch target Deployment\/web container app not found/,
  );
});

test("the post-renderer refuses a missing or malformed patch argument", () => {
  assert.throws(
    () => postRender(manifest, []),
    /expects the patches as one JSON argument/,
  );
  assert.throws(
    () => postRender(manifest, ["{"]),
    /patches argument is not valid JSON/,
  );
  assert.throws(
    () => postRender(manifest, ['{"a":1}']),
    /patches argument must be a JSON array/,
  );
});

test("the post-renderer entry runs when started through a symlink", async () => {
  const { execFileSync } = await import("node:child_process");
  const { existsSync, mkdtempSync, rmSync, symlinkSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const built = resolve(
    import.meta.dirname,
    "../../dist/src/cli/post-render.js",
  );
  if (!existsSync(built)) {
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "kore-post-render-"));
  try {
    const link = join(directory, "post-render.js");
    symlinkSync(built, link);
    const out = execFileSync(process.execPath, [link, "[]"], {
      input: manifest,
      encoding: "utf8",
    });
    assert.equal(out, manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
