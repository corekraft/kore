import { describe, expect, it } from "vitest";
import { CORPUS, ORDINARY } from "./guard-corpus.js";
import {
  REPL_REFUSED,
  REPORT_ORDINARY,
  REPORT_WRITE_REFUSED,
} from "./guard-corpus-repl.js";

const READ_ONLY = ["reader", "principles-review", "judgment"];

describe("REPL corpus data", () => {
  it("refuses every REPL case under role-read-only, for each read-only role, with one case per role and input", () => {
    expect(REPL_REFUSED.map((c) => c.role)).toEqual(
      READ_ONLY.flatMap((role) => [role, role, role, role]),
    );
    expect(
      REPL_REFUSED.every(
        (c) => c.tool === "REPL" && c.rule === "role-read-only",
      ),
    ).toBe(true);
    const keys = REPL_REFUSED.map((c) => `${c.role}|${c.input}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names a shell write, a JavaScript write and a shell read among the REPL inputs", () => {
    const inputs = REPL_REFUSED.map((c) => c.input);

    expect(inputs).toContain("await $`echo x > out.txt`");
    expect(inputs).toContain("require('fs').writeFileSync('out.txt', 'x')");
    expect(inputs).toContain("await $`cat docs/index.md`");
  });

  it("refuses a Bash write placed after a reader's session report heredoc, under role-read-only", () => {
    expect(REPORT_WRITE_REFUSED.map((c) => c.role)).toEqual(READ_ONLY);
    for (const c of REPORT_WRITE_REFUSED) {
      expect(c.tool).toBe("Bash");
      expect(c.rule).toBe("role-read-only");
      expect(c.input.endsWith("\nEOF\ntee out.txt")).toBe(true);
    }
  });

  it("keeps a read-only role's session report heredoc as an ordinary Bash call", () => {
    expect(REPORT_ORDINARY.map((c) => c.role)).toEqual(READ_ONLY);
    for (const c of REPORT_ORDINARY) {
      expect(c.tool).toBe("Bash");
      expect(
        c.input.startsWith("node skills/bin/harness.mjs session report "),
      ).toBe(true);
      expect(c.input.endsWith("\nEOF")).toBe(true);
    }
  });

  it("wires every REPL case into the corpus and the ordinary calls", () => {
    expect(CORPUS).toEqual(
      expect.arrayContaining([...REPL_REFUSED, ...REPORT_WRITE_REFUSED]),
    );
    expect(ORDINARY).toEqual(expect.arrayContaining([...REPORT_ORDINARY]));
  });
});
