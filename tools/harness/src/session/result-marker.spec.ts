import { describe, expect, it } from "vitest";
import { findResult } from "./result-marker.js";

describe("findResult: the outcome word of a turn's RESULT marker", () => {
  it("reads done from a line that is only the marker", () => {
    expect(findResult("working\nRESULT: done\n")).toBe("done");
  });

  it("reads blocked from a marker on its own line", () => {
    expect(findResult("RESULT: blocked")).toBe("blocked");
  });

  it("takes the last marker when the text carries several", () => {
    expect(findResult("RESULT: blocked\nmore work\nRESULT: done\n")).toBe(
      "done",
    );
  });

  it("accepts the bullet a Claude turn prints before a marker", () => {
    expect(findResult("● RESULT: done")).toBe("done");
    expect(findResult("⏺ RESULT: blocked")).toBe("blocked");
  });

  it("accepts a marker that ends with a carriage return, as on CRLF text", () => {
    expect(findResult("work\r\nRESULT: done\r\n")).toBe("done");
  });

  it("ignores a marker that is not at the start of its line", () => {
    expect(findResult("I will print RESULT: done at the end")).toBeUndefined();
  });

  it("ignores a word other than done or blocked", () => {
    expect(findResult("RESULT: maybe")).toBeUndefined();
  });

  it("reports no result for text with no marker", () => {
    expect(findResult("")).toBeUndefined();
    expect(findResult("just prose\n")).toBeUndefined();
  });
});
