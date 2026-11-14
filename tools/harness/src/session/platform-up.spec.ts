import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { fakeFileSystem } from "./deps-support.js";
import { platformUp } from "./platform-up.js";

vi.mock("node:path");

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
});

const lines = (...entries: object[]) =>
  entries.map((entry) => JSON.stringify(entry)).join("\n");
const start = (op: string, command: string) => ({ kind: "start", op, command });
const end = (op: string, outcome: string) => ({ kind: "end", op, outcome });

async function upAfter(text: string): Promise<boolean> {
  const fs = fakeFileSystem();
  fs.readFile.mockResolvedValue(text);
  const up = await platformUp(fs, "/main");
  expect(fs.readFile.mock.calls).toEqual([
    ["/main/.kore/state/journal/local.jsonl"],
  ]);
  return up;
}

it("is up after a local up that succeeded", async () => {
  expect(await upAfter(lines(start("1", "local up"), end("1", "ok")))).toBe(
    true,
  );
});

it("is up while a local up is still running", async () => {
  expect(await upAfter(lines(start("1", "local up")))).toBe(true);
});

it.each(["local stop", "local down", "cluster stop", "local destroy"])(
  "is not up after %s",
  async (command) => {
    expect(
      await upAfter(
        lines(
          start("1", "local up"),
          end("1", "ok"),
          start("2", command),
          end("2", "ok"),
        ),
      ),
    ).toBe(false);
  },
);

it("is not up after a local up that failed", async () => {
  expect(await upAfter(lines(start("1", "local up"), end("1", "failed")))).toBe(
    false,
  );
});

it("skips torn lines and still reads the last operation", async () => {
  expect(
    await upAfter(`not json\n${lines(start("1", "local up"))}\n{"kind"`),
  ).toBe(true);
});

it("is not up with no journal", async () => {
  const fs = fakeFileSystem();
  fs.readFile.mockRejectedValue(new Error("ENOENT"));

  expect(await platformUp(fs, "/main")).toBe(false);
});

it("is not up with an empty journal", async () => {
  expect(await upAfter("")).toBe(false);
});
