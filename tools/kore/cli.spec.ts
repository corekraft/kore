import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { main } from "./cli.js";

test("validate reports portable applications for the selected environment", async () => {
  const output: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
  try {
    assert.equal(
      await main(["validate", "--environment", "managed-example", "--json"]),
      0,
    );
    assert.match(output.join(""), /\"applications\": \[\n\s+\"reference\"/);
  } finally {
    write.mockRestore();
  }
});
