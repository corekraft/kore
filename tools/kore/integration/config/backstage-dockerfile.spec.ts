import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

async function stages(): Promise<string[]> {
  const text = await readFile(
    join(await findRoot(), "images/backstage/Dockerfile"),
    "utf8",
  );
  return text.split(/^(?=FROM )/m).filter((part) => part.startsWith("FROM "));
}

test("the runtime stage is a distroless image pinned by digest, run as non-root", async () => {
  const final = (await stages()).at(-1) ?? "";
  assert.match(
    final,
    /^FROM gcr\.io\/distroless\/nodejs26-debian13:nonroot@sha256:[0-9a-f]{64}$/m,
  );
  assert.match(final, /^USER 65532:65532$/m);
  assert.match(final, /^CMD \["src\/index\.js"\]$/m);
});

test("the build stage is pinned by digest and the runtime stage copies from it", async () => {
  const [build, final] = await stages();
  assert.match(
    build ?? "",
    /^FROM node:[^@\s]+@sha256:[0-9a-f]{64} AS build$/m,
  );
  assert.match(final ?? "", /^COPY --from=build /m);
});

test("the runtime stage adds no shell and runs nothing", async () => {
  const final = (await stages()).at(-1) ?? "";
  assert.doesNotMatch(final, /^RUN /m);
  assert.doesNotMatch(final, /\b(sh|bash|ash|busybox)\b/);
  assert.doesNotMatch(final, /^(CMD|ENTRYPOINT) \[?"?\/?(bin\/)?(sh|bash)/m);
});
