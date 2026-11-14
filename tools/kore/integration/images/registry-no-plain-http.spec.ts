import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { verifyLockedImageArgs } from "../../src/app/index.js";
import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { localSignArgs, publishImageCopy } from "../../src/images/index.js";

// Docs: docs/decisions/0058-registry-transport-tls.md

const ca = "/tmp/kore-registry-x/ca.crt";
const image = {
  reference: "127.0.0.1:30500/app@sha256:" + "a".repeat(64),
  digest: "sha256:" + "a".repeat(64),
  signer: "local-kore-key",
};

test("no node command the publish path runs skips TLS verification or allows plain HTTP", async () => {
  const repository = await loadRepository("local");
  const calls: string[][] = [];
  const runner: Runner = {
    run: async (_command, args) => {
      calls.push([...args]);
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await publishImageCopy(
    repository,
    runner,
    { tag: "x:y", address: "10.96.0.50:5000", target: "x:y" },
    {
      credential: { username: "kore-push", password: "p" },
      ca,
    },
  );

  expect(calls).toHaveLength(1);
  expect(calls.flat().join(" ")).toContain("10.96.0.50:5000");
  expect(calls.flat().join(" ")).not.toMatch(
    /insecure|allow-http|skip[-_]verify|plain-?http/i,
  );
});

test("cosign sign and verify carry the registry CA and never allow HTTP", () => {
  const sign = localSignArgs("k", image.reference, ca);
  const verify = verifyLockedImageArgs(image, "pub", ca);
  for (const args of [sign, verify]) {
    expect(args).toContain("--registry-cacert");
    expect(args[args.indexOf("--registry-cacert") + 1]).toBe(ca);
    expect(args.join(" ")).not.toMatch(/allow-http|insecure-registry/);
  }
});

test("nothing under tools/kore/src or infra names a plain-HTTP registry path", async () => {
  const forbidden =
    /--insecure-registry|--allow-http-registry|--allow-insecure-registry/;
  const root = join(import.meta.dirname, "../../../..");
  const files: string[] = [];
  for (const dir of ["tools/kore/src", "infra"]) {
    for (const entry of await readdir(join(root, dir), {
      recursive: true,
      withFileTypes: true,
    })) {
      const path = join(entry.parentPath, entry.name);
      if (
        entry.isFile() &&
        !path.includes("node_modules") &&
        !path.endsWith("registry-no-plain-http.spec.ts") &&
        /\.(ts|ya?ml|json|tpl|sh)$/.test(entry.name)
      ) {
        files.push(path);
      }
    }
  }
  const offenders: string[] = [];
  for (const file of files) {
    if (forbidden.test(await readFile(file, "utf8"))) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});
