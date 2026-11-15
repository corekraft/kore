import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "flow");

describe("flow report write path", () => {
  it("has no code that writes the ledger: events are written only through the ledger tool", () => {
    const sources = readdirSync(DIR).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"),
    );
    const writers = sources.filter((f) =>
      /\b(appendFile|writeFile|createWriteStream|rename|unlink)\w*\s*\(|\bledger\.jsonl\b/.test(
        readFileSync(join(DIR, f), "utf8"),
      ),
    );
    expect(writers).toEqual([]);
  });
});
