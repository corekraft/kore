// Which user messages the retro scan reads as orchestrator briefs. One function: no dependencies to mock.

import { describe, expect, it } from "vitest";
import { isOrchestratorBrief } from "./retro-transcript.js";

describe("orchestrator brief tag", () => {
  it.each([
    ["the fixed [orchestrator] tag", "[orchestrator] Retro ticket #411"],
    ["the fixed tag after indentation, any case", "  \n [ORCHESTRATOR] brief"],
    ["the legacy (orchestrator) header", "(orchestrator) brief"],
    ["the legacy orchestrator: header", "Orchestrator: brief"],
    ["a [herdr:name] header", "[herdr:retro-writer] brief"],
  ])("reads a message that opens with %s as a brief", (_name, text) => {
    expect(isOrchestratorBrief(text)).toBe(true);
  });

  it.each([
    [
      "a brief that holds the session-name line, with no tag",
      "Retro ticket #496\n\nYou are retro-writer; your session name is retro-writer.\n\nWhen you finish, broadcast.",
    ],
    [
      "a session-name line that opens the message, with no tag",
      "You are image-trust-writer; your session name is image-trust-writer.",
    ],
  ])("reads a message with %s as a brief", (_name, text) => {
    expect(isOrchestratorBrief(text)).toBe(true);
  });

  it.each([
    ["a person's correction", "Stop editing the widget manifests directly"],
    [
      "a person's words that say the session name is something else",
      "You are wrong; your session name is not what I asked for.",
    ],
    [
      "a person who names the tag mid-sentence",
      "Stop letting the [orchestrator] brief edit manifests",
    ],
    [
      "a message that only mentions the orchestrator",
      "Ask the orchestrator first",
    ],
  ])("does not read %s as a brief", (_name, text) => {
    expect(isOrchestratorBrief(text)).toBe(false);
  });
});
