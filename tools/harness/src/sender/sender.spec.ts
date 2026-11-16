import { describe, expect, it } from "vitest";
import {
  formatSender,
  readSender,
  senderFrom,
  withoutSender,
  type Sender,
} from "./sender.js";

const WRITER = { KORE_ROLE: "writer", KORE_AGENT: "fix-sender-identity" };
const WRITER_LINE = "sender: writer fix-sender-identity (review post)";
const MAIN_LINE = "sender: the main session (review post)";

describe("the sender line names the role, session and command from the spawn environment", () => {
  it("writes the role and session name from the environment, then the command, on one first line", () => {
    expect(senderFrom(WRITER, "review post")).toEqual({
      command: "review post",
      session: { role: "writer", name: "fix-sender-identity" },
    });
    expect(formatSender(senderFrom(WRITER, "review post") as Sender)).toBe(
      WRITER_LINE,
    );
  });

  it("writes 'the main session' when the environment names no role", () => {
    const sender = senderFrom({}, "review post") as Sender;
    expect(formatSender(sender)).toBe(MAIN_LINE);
  });

  it("carries only role, session name and command, whatever else the environment holds", () => {
    const busy = {
      ...WRITER,
      HOME: "/Users/jun",
      KORE_IDEA: "#832",
      HERDR_PANE_ID: "w3:p2",
      GH_TOKEN: "not-a-real-token",
    };
    expect(formatSender(senderFrom(busy, "review post") as Sender)).toBe(
      WRITER_LINE,
    );
  });

  it("refuses a role with no session name, rather than writing that session as the main session", () => {
    expect(senderFrom({ KORE_ROLE: "writer" }, "review post")).toEqual({
      error:
        'KORE_ROLE is "writer" but KORE_AGENT is not set, so the sender line cannot name the session. Spawn the session with `harness session spawn`, which sets both, then rerun.',
    });
  });

  it("refuses a role or session name that the line could not carry back", () => {
    expect(
      senderFrom({ KORE_ROLE: "Writer", KORE_AGENT: "fix" }, "review post"),
    ).toEqual({
      error:
        'KORE_ROLE "Writer" is not a role name a sender line can carry: use lowercase letters, digits and "-", starting with a letter.',
    });
    expect(
      senderFrom({ KORE_ROLE: "writer", KORE_AGENT: "fix me" }, "review post"),
    ).toEqual({
      error:
        'KORE_AGENT "fix me" is not a session name a sender line can carry: use lowercase letters, digits, "-" and "_".',
    });
  });
});

describe("the sender line is read back from the first line of a body", () => {
  it("reads back the sender it was written from", () => {
    const sender = senderFrom(WRITER, "review post") as Sender;
    expect(readSender(`${formatSender(sender)}\nprinciples-review: x`)).toEqual(
      sender,
    );
  });

  it("reads back the main session from its line", () => {
    expect(readSender(`${MAIN_LINE}\nbody`)).toEqual({
      command: "review post",
    });
  });

  it("reads no sender from an untagged body, which is the owner's", () => {
    expect(
      readSender("principles-review: No violations. (head 1234abcd)"),
    ).toBeUndefined();
  });

  it("reads no sender from a sender-looking line that is not the first line", () => {
    expect(readSender(`Looks right.\n${WRITER_LINE}`)).toBeUndefined();
  });

  it("reads no sender from a line that is not exactly the format", () => {
    expect(readSender("sender: writer fix-sender-identity")).toBeUndefined();
  });
});

describe("withoutSender drops a first-line sender line and nothing else", () => {
  it("drops the sender line that starts the body", () => {
    expect(
      withoutSender(`${WRITER_LINE}\nprinciples-review: No violations.`),
    ).toBe("principles-review: No violations.");
  });

  it("leaves nothing of a body that is only a sender line", () => {
    expect(withoutSender(WRITER_LINE)).toBe("");
  });

  it("leaves a body with no sender line exactly as it was", () => {
    expect(withoutSender("principles-review: No violations.")).toBe(
      "principles-review: No violations.",
    );
  });

  it("leaves a sender-looking line that is not first in place", () => {
    const body = `Looks right.\n${WRITER_LINE}`;
    expect(withoutSender(body)).toBe(body);
  });
});
