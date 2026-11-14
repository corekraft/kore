import { describe, expect, it } from "vitest";
import { spawnLoadRefusal } from "./spawn-load.js";

// The host load is read through an injected source, so this unit starts no
// process and reads no real load average.

const withLoad = (env: Record<string, string>, oneMinute: number) => ({
  env,
  hostLoad: { oneMinute: () => oneMinute },
});

describe("session spawn load refusal", () => {
  it("never reads the load when KORE_SPAWN_MAX_LOAD is unset", () => {
    const unread = {
      env: {},
      hostLoad: {
        oneMinute: (): number => {
          throw new Error("the load must not be read");
        },
      },
    };

    expect(spawnLoadRefusal(unread)).toBeUndefined();
  });

  it("treats an empty KORE_SPAWN_MAX_LOAD as unset", () => {
    expect(
      spawnLoadRefusal(withLoad({ KORE_SPAWN_MAX_LOAD: "" }, 44)),
    ).toBeUndefined();
  });

  it("spawns when the load is below the threshold", () => {
    expect(
      spawnLoadRefusal(withLoad({ KORE_SPAWN_MAX_LOAD: "20" }, 19.99)),
    ).toBeUndefined();
  });

  it("spawns when the load is exactly at the threshold", () => {
    expect(
      spawnLoadRefusal(withLoad({ KORE_SPAWN_MAX_LOAD: "20" }, 20)),
    ).toBeUndefined();
  });

  it("refuses above the threshold, naming the load, the threshold and how to proceed", () => {
    expect(
      spawnLoadRefusal(withLoad({ KORE_SPAWN_MAX_LOAD: "20" }, 44.5)),
    ).toBe(
      "The host 1-minute load average is 44.50, above KORE_SPAWN_MAX_LOAD=20, so a new writer would add load to a busy host. Wait for the load to fall and spawn again, or raise KORE_SPAWN_MAX_LOAD (or unset it) to override. No session was started.",
    );
  });

  it("refuses a setting that is not a number, naming the value", () => {
    expect(spawnLoadRefusal(withLoad({ KORE_SPAWN_MAX_LOAD: "abc" }, 1))).toBe(
      'KORE_SPAWN_MAX_LOAD must be a number such as 20, or unset; got "abc". No session was started.',
    );
  });

  it("refuses rather than spawn when the load cannot be read", () => {
    expect(spawnLoadRefusal({ env: { KORE_SPAWN_MAX_LOAD: "20" } })).toBe(
      "The host load average cannot be read, so KORE_SPAWN_MAX_LOAD=20 cannot be checked. Unset KORE_SPAWN_MAX_LOAD to spawn without the check. No session was started.",
    );
  });
});
