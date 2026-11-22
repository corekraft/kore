import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const IDEA = "0078-writer-sandbox-denies-the-hc-socket-and-credentials";

describe("the writer sandbox idea (plan 16, step 1)", () => {
  it("is filed with a measurable hypothesis and the three facts the issue names", async () => {
    const text = await readFile(join(ROOT, "docs/ideas", IDEA + ".md"), "utf8");
    expect(text).toMatch(/^hypothesis: .+/m);
    expect(text).toMatch(/^measurement: .+/m);
    expect(text).toContain("#337");
    expect(text).toContain("ADR 0095");
    expect(text).toContain("tools/harness/tests/writer-sandbox-support.ts");
    expect(text).toContain("HC_SOCKET");
    expect(text).toContain("~/.config/kore");
    expect(text).toContain("~/.config/sops");
    expect(text).toContain("hands them their token and sandbox");
  });

  it("is indexed under ## Ideas in docs/index.md", async () => {
    const index = await readFile(join(ROOT, "docs/index.md"), "utf8");
    expect(index).toContain(
      "- [`docs/ideas/" + IDEA + ".md`](ideas/" + IDEA + ".md) — ",
    );
  });

  it("is linked from plan 16's Findings", async () => {
    const plan = await readFile(
      join(ROOT, "infra/plans/16-hc-native-sessions.md"),
      "utf8",
    );
    expect(plan).toContain("../../docs/ideas/" + IDEA + ".md");
  });
});
