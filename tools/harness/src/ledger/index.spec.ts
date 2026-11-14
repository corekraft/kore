import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import { pollGithub } from "./github-poll.js";
import { pollSignals } from "./github-signals.js";
import { pollHerdr } from "./herdr-poll.js";

vi.mock("./github-poll.js");
vi.mock("./github-signals.js");
vi.mock("./herdr-poll.js");
vi.mock("./ledger.js");
vi.mock("./schema.js");

describe("the ledger barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "DEFAULT_LEDGER",
      "KINDS",
      "Ledger",
      "POLLER_KINDS",
      "SOURCES",
      "isName",
      "isTimestamp",
      "pollGithub",
      "pollHerdr",
      "pollSignals",
    ]);
  });

  it("re-exports the pollers as the units' own functions, not copies", () => {
    expect(barrel.pollGithub).toBe(pollGithub);
    expect(barrel.pollSignals).toBe(pollSignals);
    expect(barrel.pollHerdr).toBe(pollHerdr);
  });
});
