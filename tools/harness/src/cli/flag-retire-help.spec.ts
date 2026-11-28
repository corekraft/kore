// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { describe, expect, it } from "vitest";
import { retireHelp } from "./flag-retire-help.js";

describe("retireHelp for flag retire", () => {
  it("says where the soak is configured, so a writer does not look for it in code", () => {
    expect(retireHelp.purpose).toMatch(
      /retireSoakDays in \.claude\/harness\.json/,
    );
  });

  it("states that a refusal writes nothing, and that an eligible run changes the overlays and manifest", () => {
    expect(retireHelp.exits).toContainEqual(
      expect.objectContaining({
        code: 1,
        meaning: expect.stringMatching(
          /nothing is written|refused and nothing is written/,
        ),
      }),
    );
    expect(retireHelp.effects.kind).toBe("mutates");
    expect(retireHelp.effects.detail).toMatch(/infra\/catalog\/flags\.yaml/);
  });

  it("shows the command with its flag operand in an example", () => {
    expect(retireHelp.examples).toContainEqual(
      expect.objectContaining({
        command: expect.stringMatching(/^harness flag retire \S+/),
      }),
    );
  });
});
