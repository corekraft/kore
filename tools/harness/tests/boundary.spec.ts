import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      return sources(join(dir, e.name));
    }
    return e.name.endsWith(".ts") ? [join(dir, e.name)] : [];
  });
}

describe("harness boundary", () => {
  it("imports nothing from tools/kore/src", () => {
    const offenders = sources(src).filter((f) =>
      /from\s+["'][^"']*(tools\/kore|\.\.\/kore\/|kore\/src)/.test(
        readFileSync(f, "utf8"),
      ),
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
