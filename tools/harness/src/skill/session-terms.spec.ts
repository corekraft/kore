import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAIN_SESSION_WAIT_LINE,
  RESULT_SUMMARY_LINE,
  SIGNED_SEND_LINE,
} from "../hook/index.js";

const ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** A pane or a tab named for a session: the herdr words the hc model retired. */
const PANE_OR_TAB = /\b(panes?|tabs?)\b/i;

/** The two ledger event names that keep "pane" in their dotted name. */
const LEDGER_EVENT_NAMES = /`pane\.(finished|stalled)`/g;

describe("the session terms in the glossary", () => {
  const glossary = read("GLOSSARY.md");

  it("defines Terminal, Report, Delivery terminal and Group", () => {
    for (const term of ["Terminal", "Report", "Delivery terminal", "Group"]) {
      expect(glossary).toContain(`**${term}**:`);
    }
  });

  it("names the session result, with pane result only as a word to avoid", () => {
    expect(glossary).toContain("**Session result**:");
    expect(glossary).not.toContain("**Pane result**:");
    const entry = glossary
      .split("\n\n")
      .find((block) => block.startsWith("**Session result**:"));
    expect(entry).toContain("_Avoid_: Finish line, notification, Pane result");
  });

  it("names no pane or tab for a session, except Pane result under Avoid", () => {
    const named = "_Avoid_: Finish line, notification, Pane result";
    expect(glossary).toContain(named);
    const rest = glossary.replace(named, "").replace(LEDGER_EVENT_NAMES, "");
    expect(rest).not.toMatch(PANE_OR_TAB);
  });

  it("keeps the ledger event names pane.finished and pane.stalled, as event names", () => {
    const block = (term: string) =>
      glossary.split("\n\n").find((b) => b.startsWith(`**${term}**:`));
    expect(block("Finish detection")).toContain("`pane.finished`");
    expect(block("Silent session")).toContain("`pane.stalled`");
    expect("a pane result and a tab".replace(LEDGER_EVENT_NAMES, "")).toMatch(
      PANE_OR_TAB,
    );
    expect("the `pane.finished` pane".replace(LEDGER_EVENT_NAMES, "")).toMatch(
      PANE_OR_TAB,
    );
  });

  it("takes follow-up's provenance from hc's tag, not a sender line on every message", () => {
    expect(glossary).not.toContain("always carrying a sender line");
    expect(glossary).toContain("hc's tag");
  });

  it("says the read of a term changes with its source", () => {
    const finish = glossary
      .split("\n\n")
      .find((block) => block.startsWith("**Finish detection**:"));
    expect(finish).toContain("per ledger source");
  });
});

describe("the session rules in AGENTS.md", () => {
  const agents = read("AGENTS.md");

  it("names no pane or tab for a session", () => {
    expect(agents).not.toMatch(PANE_OR_TAB);
  });

  it("points the sender rule at hc's tag and keeps the GitHub sender line", () => {
    expect(agents).toContain("hc's tag");
    expect(agents).toContain("`sender: <role> <session> (<command>)` line");
  });

  it("names only the token a role terminal is handed, not a sandbox", () => {
    expect(agents).toContain("which hands them their token;");
    expect(agents).not.toContain("sandbox");
  });
});

describe("the relay note in hc-pin.md", () => {
  it("shows how a relay is sent to a machine session", () => {
    expect(read("docs/operations/hc-pin.md")).toContain(
      "hc send kore-agents/<id>",
    );
  });
});

describe("the session hints", () => {
  it("name no pane, tab or typed sender line", () => {
    for (const line of [
      RESULT_SUMMARY_LINE,
      SIGNED_SEND_LINE,
      MAIN_SESSION_WAIT_LINE,
    ]) {
      expect(line).not.toMatch(PANE_OR_TAB);
      expect(line).not.toMatch(/sender:/i);
    }
  });
});
