import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { ticketQueueOn } from "../queue/index.js";
import { harnessLabel, ideaRecordCommands } from "./idea-commands.js";

vi.mock("../idea/index.js", () => ({
  ideaCommandsWith: vi.fn(() => ({ sync: "the sync command" })),
}));
vi.mock("../queue/index.js", () => ({ ticketQueueOn: vi.fn() }));

describe("the idea commands the CLI registers", () => {
  it("registers the idea command table built for the CLI", () => {
    expect(ideaRecordCommands).toEqual({ sync: "the sync command" });
  });
});

describe("the harness label reader the CLI gives idea sync", () => {
  it("reads the tick-ticket-queue flag from the local overlay of the checkout the command runs in", async () => {
    const fs = { name: "fs" };
    vi.mocked(ticketQueueOn).mockResolvedValue(true);
    const context = {
      deps: {
        fs,
        root: () => Promise.resolve("/repo"),
      },
    } as unknown as CommandContext;

    expect(await harnessLabel(context)).toBe(true);
    expect(ticketQueueOn).toHaveBeenCalledWith(fs, "/repo");
  });

  it("is off when the flag is off in the local overlay", async () => {
    vi.mocked(ticketQueueOn).mockResolvedValue(false);
    const context = {
      deps: { fs: {}, root: () => Promise.resolve("/repo") },
    } as unknown as CommandContext;

    expect(await harnessLabel(context)).toBe(false);
  });
});
