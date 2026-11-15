// What a refusal leaves behind: one comment on the idea, and no change to the mode.
// Every port, the inventory parser and the text edits are mocks.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type IssueComment } from "./activate.js";
import {
  fake,
  GUARDRAILS,
  LATER,
  REQUEST_AT,
  requestBody,
} from "./activate-support.js";
import { parseInventory, type Guardrail } from "./inventory.js";
import { withMode, withoutRule } from "./edit.js";

vi.mock("./edit.js");
vi.mock("./request.js", () => ({
  marker: (label: string) => `<!-- guardrail-request: ${label} -->`,
  requestLabel: (rule: string, from: string, to: string) =>
    `${rule}:${from}>${to}`,
}));
vi.mock("./inventory.js", async (original) => ({
  ...(await original<typeof import("./inventory.js")>()),
  parseInventory: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(withMode).mockReturnValue("EDITED");
  vi.mocked(withoutRule).mockReturnValue("REMOVED");
  vi.mocked(parseInventory).mockReturnValue({ guardrails: [] });
});

const none = (label: string): IssueComment[] => [
  { author: "claude", createdAt: REQUEST_AT, body: requestBody(label) },
];

describe("a refusal", () => {
  const target = GUARDRAILS["guard"] as Guardrail;
  it("is recorded once on the idea's issue and changes no mode", async () => {
    const f = fake(target, none);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result).toMatchObject({
      activated: false,
      refusalPosted: true,
      commentUrl: "https://github.com/o/r/issues/224#c9",
    });
    expect(f.commentOn).toHaveBeenCalledWith(
      "224",
      expect.stringContaining(
        "<!-- guardrail-refusal: bare-glob:audit>enforce no-approval -->",
      ),
    );
    expect(f.writeInventory).not.toHaveBeenCalled();
  });

  it("is not posted again when the same refusal is already on the issue", async () => {
    const f = fake(target, (label) => [
      ...none(label),
      {
        author: "claude",
        createdAt: LATER,
        body: `<!-- guardrail-refusal: ${label} no-approval -->`,
      },
    ]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.refusalPosted).toBe(false);
    expect(f.commentOn).not.toHaveBeenCalled();
  });
});
