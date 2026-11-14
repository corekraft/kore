// `harness hook retro-scan --evidence`: guard-block locations on top of the default report.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { afterEach, describe, expect, it } from "vitest";
import { fixtures } from "./retro-scan-support.js";
import { removeTemps, repoRoot, retro } from "./retro-hook-support.js";

afterEach(removeTemps);

describe("hook retro-scan --evidence", () => {
  it("adds guardEvidence beside the guard counts only when asked", async () => {
    const root = repoRoot();
    const plain = (await retro(root, ["--dir", fixtures])).out;
    expect(JSON.parse(plain)).not.toHaveProperty("guardEvidence");

    const result = await retro(root, ["--dir", fixtures, "--evidence"]);
    expect(result).toMatchObject({ code: 0, err: "" });
    const report = JSON.parse(result.out) as Record<string, unknown>;
    expect(report["guardEvidence"]).toEqual({
      "kubectl-context": [
        {
          session: "alpha",
          line: 16,
          excerpt:
            "PreToolUse:Bash hook error: [node <q>]: [guard:kubectl-context] synthetic block for kubectl-context.",
        },
      ],
    });
    expect(report["guards"]).toEqual(
      (JSON.parse(plain) as Record<string, unknown>)["guards"],
    );
  });
});
