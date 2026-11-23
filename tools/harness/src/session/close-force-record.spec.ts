import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminals, type Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { forceRecordClose } from "./close-force-record.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

vi.mock("./backend.js", () => ({ hcMessage: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hcMessage).mockReturnValue("the hc message");
});

const NOW = "2026-01-02T03:04:05.000Z";

/** A record the flip left behind: its name, pane and the identity fields, with the terminal id when it has one. */
function recordOf(name: string, terminal?: string): SessionRecord {
  return {
    version: 1,
    backend: "hc",
    name,
    paneId: terminal ?? "",
    ...(terminal === undefined ? {} : { terminal }),
    model: "claude-sonnet-5-5",
    role: "writer",
    effort: "high",
    createdAt: NOW,
  };
}

/** A registry with the two calls --force-record makes: read the record, remove its file. */
function registryOf(record: SessionRecord | undefined) {
  const read = vi.fn((): Promise<SessionRecord | undefined> =>
    Promise.resolve(record),
  );
  const remove = vi.fn((): Promise<void> => Promise.resolve());
  return {
    read,
    remove,
    fake: { read, remove } as unknown as Pick<
      SessionRegistry,
      "read" | "remove"
    >,
  };
}

/** The caller is t1; a writer named image-trust-writer runs as its child on a terminal of its own. */
async function worldWithChild(): Promise<{
  terminals: FakeTerminals;
  child: string;
}> {
  const terminals = new FakeTerminals({ self: "t1" });
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  const started = await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
  });
  if ("error" in started) {
    throw new Error(started.error.message);
  }
  return { terminals, child: started.id };
}

describe("session close --force-record removes only a record whose terminal is not live in hc", () => {
  it("removes a record that never got a terminal id, without asking hc", async () => {
    const { terminals } = await worldWithChild();
    const get = vi.spyOn(terminals, "get");
    const registry = registryOf(recordOf("image-trust-writer"));

    const result = await forceRecordClose(
      "image-trust-writer",
      terminals,
      registry.fake,
    );

    expect(result).toEqual({ removed: "image-trust-writer" });
    expect(registry.remove).toHaveBeenCalledExactlyOnceWith(
      "image-trust-writer",
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("removes a record whose terminal has finished in hc", async () => {
    const { terminals, child } = await worldWithChild();
    await terminals.kill(child);
    const registry = registryOf(recordOf("image-trust-writer", child));

    const result = await forceRecordClose(
      "image-trust-writer",
      terminals,
      registry.fake,
    );

    expect(result).toEqual({ removed: "image-trust-writer" });
    expect(registry.remove).toHaveBeenCalledExactlyOnceWith(
      "image-trust-writer",
    );
  });

  it("removes a record whose terminal hc no longer has", async () => {
    const { terminals } = await worldWithChild();
    const registry = registryOf(recordOf("image-trust-writer", "t99"));

    const result = await forceRecordClose(
      "image-trust-writer",
      terminals,
      registry.fake,
    );

    expect(result).toEqual({ removed: "image-trust-writer" });
    expect(registry.remove).toHaveBeenCalledExactlyOnceWith(
      "image-trust-writer",
    );
  });
});

describe("session close --force-record keeps the record it cannot prove is safe to remove", () => {
  it("refuses and keeps the record while its terminal is live in hc, naming the terminal and the close that ends it", async () => {
    const { terminals, child } = await worldWithChild();
    const registry = registryOf(recordOf("image-trust-writer", child));

    const result = await forceRecordClose(
      "image-trust-writer",
      terminals,
      registry.fake,
    );

    expect(result).toEqual({
      error: expect.stringContaining(`terminal ${child}, which is live in hc`),
    });
    expect(result).toEqual({
      error: expect.stringContaining(
        "harness session close image-trust-writer",
      ),
    });
    expect(registry.remove).not.toHaveBeenCalled();
  });

  it("keeps the record when hc cannot say whether the terminal is live, and names hc's message", async () => {
    const refusal = {
      error: {
        kind: "unreachable",
        message: "the hc core is not running",
        hint: "start hc, then retry",
      },
    };
    const unreachable = {
      get: vi.fn(() => Promise.resolve(refusal)),
    } as unknown as Terminals;
    const registry = registryOf(recordOf("image-trust-writer", "t2"));

    const result = await forceRecordClose(
      "image-trust-writer",
      unreachable,
      registry.fake,
    );

    expect(hcMessage).toHaveBeenCalledWith(refusal);
    expect(result).toEqual({
      error: expect.stringContaining("(the hc message)"),
    });
    expect(registry.remove).not.toHaveBeenCalled();
  });

  it("says there is no record to remove when none exists, and removes nothing", async () => {
    const { terminals } = await worldWithChild();
    const registry = registryOf(undefined);

    const result = await forceRecordClose(
      "image-trust-writer",
      terminals,
      registry.fake,
    );

    expect(result).toEqual({
      error:
        "No session record named image-trust-writer exists, so there is nothing to remove.",
    });
    expect(registry.remove).not.toHaveBeenCalled();
  });
});
