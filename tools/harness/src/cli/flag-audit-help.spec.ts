// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { describe, expect, it } from "vitest";
import { auditHelp } from "./flag-audit-help.js";

describe("auditHelp for flag audit --vps", () => {
  it("documents --vps as the vps audit whose mode the vps-flag-proof guardrail sets", () => {
    expect(auditHelp.flags["vps"]).toMatch(/vps-flag-proof/);
    expect(auditHelp.flags["vps"]).toMatch(/owner waiver does not count/);
  });

  it("shows the --vps example and says it exits zero while the rule is in audit", () => {
    expect(auditHelp.examples).toContainEqual(
      expect.objectContaining({ command: "harness flag audit --vps" }),
    );
    expect(
      auditHelp.exits.some(
        (exit) => exit.code === 0 && /--vps/.test(exit.meaning),
      ),
    ).toBe(true);
  });
});
