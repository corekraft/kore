// Docs: docs/decisions/0089-declarative-probe-patches-through-a-helm-post-renderer.md
// Real process: starts the built post-renderer through a symlink. The unit spec
// (src/cli/post-render.spec.ts) covers postRender() alone.
import assert from "node:assert/strict";
import { test } from "vitest";

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

test("the post-renderer entry runs when started through a symlink", async (context) => {
  const { execFileSync } = await import("node:child_process");
  const { existsSync, mkdtempSync, rmSync, symlinkSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const built = resolve(import.meta.dirname, "../dist/src/cli/post-render.js");
  if (!existsSync(built)) {
    context.skip(
      "tools/kore/dist is not built; run `npm run build` (npm test builds first)",
    );
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
