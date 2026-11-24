import { describe, expect, it, vi } from "vitest";
import { flagCommands } from "./flag-commands.js";
import { platformCommands } from "./platform-commands.js";
import { releaseRecords } from "./release-records.js";

vi.mock("./flag-commands.js", () => ({ flagCommands: { activate: {} } }));
vi.mock("./platform-commands.js", () => ({
  platformCommands: { "rollout-record": {} },
}));

describe("the release records", () => {
  it("map the flag and platform domain words to their own command maps", () => {
    expect(Object.keys(releaseRecords).sort()).toEqual(["flag", "platform"]);
    expect(releaseRecords.flag).toBe(flagCommands);
    expect(releaseRecords.platform).toBe(platformCommands);
  });
});
