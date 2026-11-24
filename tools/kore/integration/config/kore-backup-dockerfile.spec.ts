import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0116-application-runtime-images-are-distroless-builder-stages-can-be-anything.md
// The kore-backup image (issue 1639, spec 1610): the runtime stage is distroless with
// no shell and no package manager; pg_dump and age come from pinned builder stages.

async function dockerfile(): Promise<string> {
  return readFile(
    join(await findRoot(), "images/kore-backup/Dockerfile"),
    "utf8",
  );
}

async function stages(): Promise<string[]> {
  return (await dockerfile())
    .split(/^(?=FROM )/m)
    .filter((part) => part.startsWith("FROM "));
}

test("the runtime stage is the distroless Node image pinned by digest, run as the numeric non-root user", async () => {
  const final = (await stages()).at(-1) ?? "";
  assert.match(
    final,
    /^FROM gcr\.io\/distroless\/nodejs26-debian13:nonroot@sha256:[0-9a-f]{64}$/m,
  );
  assert.match(final, /^USER 65532:65532$/m);
});

test("the runtime stage adds no shell and no package manager, and runs nothing", async () => {
  const final = (await stages()).at(-1) ?? "";
  assert.doesNotMatch(final, /^RUN /m);
  assert.doesNotMatch(final, /\b(sh|bash|ash|busybox|dash)\b/);
  assert.doesNotMatch(final, /\b(apk|apt|apt-get|dnf|yum|microdnf|zypper)\b/);
  assert.doesNotMatch(final, /\b(pip|npm|yarn|pnpm)\s+(install|add|ci)\b/);
  assert.doesNotMatch(final, /^(CMD|ENTRYPOINT) \[?"?\/?(bin\/)?(sh|bash)/m);
});

test("every stage is pinned by digest, builder stages included", async () => {
  for (const from of await stages()) {
    assert.match(
      from.split("\n")[0] ?? "",
      /^FROM \S+@sha256:[0-9a-f]{64}( AS \w+)?$/,
    );
  }
});

test("the entrypoint is the distroless node binary running the kore-backup program, so job arguments reach the program", async () => {
  const final = (await stages()).at(-1) ?? "";
  assert.match(
    final,
    /^ENTRYPOINT \["\/nodejs\/bin\/node", "\/app\/dist\/src\/cluster\/backup-main\.js"\]$/m,
  );
  assert.doesNotMatch(final, /^CMD /m);
});

test("the program is compiled in a builder stage and only its output reaches the runtime stage", async () => {
  const text = await dockerfile();
  assert.match(text, /^FROM node:[^@\s]+@sha256:[0-9a-f]{64} AS program$/m);
  assert.match(text, /^RUN npm ci --ignore-scripts \\$/m);
  assert.match(text, /^ {4}&& npm run build$/m);
  const final = (await stages()).at(-1) ?? "";
  assert.match(
    final,
    /^COPY --from=program \/src\/dist\/src \/app\/dist\/src$/m,
  );
});

test("pg_dump is the PostgreSQL 18 client from a trixie builder, matching the newest major in use, with its shared libraries", async () => {
  const text = await dockerfile();
  assert.match(
    text,
    /^FROM postgres:18-trixie@sha256:[0-9a-f]{64} AS libraries$/m,
  );
  assert.match(text, /\/usr\/lib\/postgresql\/18\/bin\/pg_dump/);
  assert.match(text, /ldd \/usr\/lib\/postgresql\/18\/bin\/pg_dump/);
  const final = (await stages()).at(-1) ?? "";
  assert.match(final, /^COPY --from=libraries \/stage\/ \/$/m);
});

test("the libraries stage never copies glibc, which the distroless base already carries", async () => {
  const text = await dockerfile();
  assert.ok(
    text.includes("libc\\|libm\\|libpthread\\|libdl\\|libresolv\\|libgcc_s"),
    "the copy filter names the glibc libraries it leaves out",
  );
});

test("age is the mise-pinned release verified by its SHA-256 before it is installed", async () => {
  const text = await dockerfile();
  assert.match(text, /^ARG AGE_VERSION=1\.3\.2$/m);
  assert.match(
    text,
    /^ARG AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10$/m,
  );
  assert.match(text, /sha256sum -c -/);
  assert.match(text, /age-v\$\{AGE_VERSION\}-linux-amd64\.tar\.gz/);
});

test("the image carries the program's PATH entries for pg_dump and age and links the source repository", async () => {
  const final = (await stages()).at(-1) ?? "";
  assert.match(final, /^ENV PATH=\/usr\/local\/bin:\/usr\/bin:\/bin$/m);
  assert.match(
    final,
    /^LABEL org\.opencontainers\.image\.source="https:\/\/github\.com\/corekraft\/kore"$/m,
  );
});

test("the kore-backup Dockerfile is linted by the hadolint task beside the other Dockerfiles", async () => {
  const mise = await readFile(join(await findRoot(), ".mise.toml"), "utf8");
  assert.match(mise, /hadolint [^"\n]*images\/kore-backup\/Dockerfile/);
});
