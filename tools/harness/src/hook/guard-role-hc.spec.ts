import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkHcWrite } from "./guard-role-hc.js";
import { commandOf } from "./guard-shell.js";
import { block } from "./guard-verdict.js";

vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

/** Fake of commandOf's contract: skips NAME=value words and the env wrapper, then names the command. */
function fakeCommandOf(tokens: readonly string[]) {
  let index = 0;
  while (
    index < tokens.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "") ||
      tokens[index] === "env")
  ) {
    index++;
  }
  return index >= tokens.length
    ? { name: "", args: [] }
    : { name: tokens[index] ?? "", args: tokens.slice(index + 1) };
}

/** The message the writer's refusal names, for the segment it refuses. */
const MESSAGE = (what: string) =>
  what +
  " drives or relabels a terminal by hand: a raw hc send, label, run or exec, or an HC_TERMINAL_ID prefix, can type into or relabel a terminal, and a label is what names a role. " +
  "Instead, message a session with `node skills/bin/harness.mjs session send <name> --message <text>`, or report with `node skills/bin/harness.mjs session report`.";

beforeEach(() => {
  vi.mocked(commandOf).mockImplementation(fakeCommandOf);
  vi.mocked(block).mockImplementation((rule: string, message: string) => ({
    action: "block" as const,
    rule,
    message,
  }));
});

describe("checkHcWrite: the writer's raw hc writes (audit, ADR 0080)", () => {
  it.each([
    "hc send t1 hi",
    "hc label t1 kore-role=writer",
    "hc run --bg -- ls",
    "hc exec t1 -- ls",
    "hc --json send t1 hi",
    "HC_TERMINAL_ID=t1 hc get t1",
    "env HC_TERMINAL_ID=t1 hc ls",
    "HC_TERMINAL_ID=t1",
  ])("names %s under role-hc-raw for the writer", (command) => {
    expect(checkHcWrite(command.split(" "), "writer")).toEqual({
      action: "block",
      rule: "role-hc-raw",
      message: MESSAGE("`" + command + "`"),
    });
  });

  it.each([
    "hc get t1",
    "hc ls --json",
    "hc wait t1",
    "cat send",
    "echo HC_TERMINAL_ID",
  ])("allows %s, which writes no terminal", (command) => {
    expect(checkHcWrite(command.split(" "), "writer")).toBeNull();
    expect(block).not.toHaveBeenCalled();
  });

  it.each(["reader", "principles-review", "judgment", "judge"])(
    "leaves %s to its own allowlist, which refuses the same commands",
    (role) => {
      expect(checkHcWrite(["hc", "send", "t1", "hi"], role)).toBeNull();
    },
  );

  it("leaves a session with no role to its own rules", () => {
    expect(checkHcWrite(["hc", "send", "t1", "hi"], undefined)).toBeNull();
  });
});
