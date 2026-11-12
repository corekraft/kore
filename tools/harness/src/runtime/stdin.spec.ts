import { describe, expect, it } from "vitest";
import { readStdin } from "./stdin.js";

async function* chunks(...parts: string[]) {
  for (const part of parts) {
    yield Buffer.from(part);
  }
}

describe("readStdin", () => {
  it("joins every chunk piped in", async () => {
    expect(await readStdin(Object.assign(chunks('{"a":', "1}"), {}))).toBe(
      '{"a":1}',
    );
  });

  it("returns empty at once on a terminal, so a hook run by hand never hangs", async () => {
    let read = false;
    async function* never() {
      read = true;
      yield Buffer.from("x");
    }

    expect(await readStdin(Object.assign(never(), { isTTY: true }))).toBe("");
    expect(read).toBe(false);
  });
});
