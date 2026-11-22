import { describe, expect, it, vi } from "vitest";
import { FakeTerminals } from "../terminal/index.js";
import { resolveParent } from "./spawn-hc-parent.js";

vi.mock("./backend.js", () => ({
  hcMessage: vi.fn(
    (error: { error: { message: string } }) => `hc: ${error.error.message}`,
  ),
}));

const NO_DELIVERY =
  "No live terminal is labelled kore-delivery=1, so the session has no parent. Run session spawn from an hc terminal, or label the delivery terminal: hc label <id> kore-delivery=1.";

/** Starts a terminal in the fake, labelled as the delivery terminal when asked. */
async function start(
  terminals: FakeTerminals,
  name: string,
  delivery = false,
): Promise<string> {
  const started = await terminals.run({
    argv: ["bash"],
    cwd: "/w",
    name,
    ...(delivery ? { labels: { "kore-delivery": "1" } } : {}),
  });
  if ("error" in started) {
    throw new Error(started.error.message);
  }
  return started.id;
}

describe("resolveParent parents a session under the terminal the caller is", () => {
  it("parents it under the caller's own terminal, which is not the delivery one, so its children keep their notes", async () => {
    const terminals = new FakeTerminals({ self: "t1" });
    await start(terminals, "caller");

    await expect(resolveParent(terminals)).resolves.toEqual({
      parent: "t1",
      delivery: false,
    });
  });

  it("marks the children of a caller that is the delivery terminal, so they start with --no-notify", async () => {
    const terminals = new FakeTerminals({ self: "t1" });
    await start(terminals, "delivery", true);

    await expect(resolveParent(terminals)).resolves.toEqual({
      parent: "t1",
      delivery: true,
    });
  });

  it("refuses a caller whose terminal hc does not know, and names hc's own message", async () => {
    const terminals = new FakeTerminals({ self: "t9" });

    await expect(resolveParent(terminals)).resolves.toEqual({
      error: "hc: no terminal t9",
    });
  });
});

describe("resolveParent finds the one live delivery terminal for a caller that is not a terminal", () => {
  it("parents the session under the one live terminal labelled kore-delivery=1", async () => {
    const terminals = new FakeTerminals();
    await start(terminals, "delivery", true);
    await start(terminals, "other");

    await expect(resolveParent(terminals)).resolves.toEqual({
      parent: "t1",
      delivery: true,
    });
  });

  it("refuses with a hint on how to start one when no live terminal carries the label", async () => {
    const terminals = new FakeTerminals();
    await start(terminals, "other");

    await expect(resolveParent(terminals)).resolves.toEqual({
      error: NO_DELIVERY,
    });
  });

  it("ignores a delivery terminal that has finished, and refuses as if none were there", async () => {
    const terminals = new FakeTerminals();
    const id = await start(terminals, "delivery", true);
    terminals.finish(id, 0);

    await expect(resolveParent(terminals)).resolves.toEqual({
      error: NO_DELIVERY,
    });
  });

  it("refuses when two live terminals carry the label, naming both, and never picks one", async () => {
    const terminals = new FakeTerminals();
    await start(terminals, "first", true);
    await start(terminals, "second", true);

    await expect(resolveParent(terminals)).resolves.toEqual({
      error:
        "2 live terminals are labelled kore-delivery=1 (t1, t2), so the session has no one parent. Label all but one kore-delivery=0 with hc label <id> kore-delivery=0, so exactly one is kore-delivery=1.",
    });
  });
});
