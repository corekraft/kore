import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasNonLiteralLoad, importSpecifiers } from "./import-scan-support.js";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      return sources(join(dir, e.name));
    }
    return e.name.endsWith(".ts") ? [join(dir, e.name)] : [];
  });
}

function isKore(spec: string): boolean {
  return (
    /(^|\/)tools\/kore|(^|\/)kore\/src/.test(spec) ||
    /^(\.\.\/)+kore\//.test(spec)
  );
}

function relative(file: string): string {
  return file.slice(src.length + 1);
}

describe("harness boundary", () => {
  it("imports nothing from tools/kore/src, by any import form", () => {
    const offenders = sources(src).filter((f) =>
      importSpecifiers(readFileSync(f, "utf8")).some(isKore),
    );
    expect(offenders).toEqual([]);
  });

  it("loads only literal specifiers", () => {
    expect(
      sources(src).filter((f) => hasNonLiteralLoad(readFileSync(f, "utf8"))),
    ).toEqual([]);
  });

  it("reaches another domain only through its index.js (ADR 0082)", () => {
    const offenders = sources(src)
      .filter((f) => !f.endsWith(".spec.ts") && !f.endsWith("-support.ts"))
      .flatMap((f) =>
        importSpecifiers(readFileSync(f, "utf8"))
          .filter((spec) => /^\.\.\/(?!\.)[^/]+\/(?!index\.js$)/.test(spec))
          .map((spec) => `${relative(f)} -> ${spec}`),
      );
    expect(offenders).toEqual([]);
  });

  it("depends on no runtime package", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(src, "../package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(pkg.dependencies).toBeUndefined();
  });
});
