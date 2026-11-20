import { describe, expect, it } from "vitest";
import { QueueError } from "./queue-error.js";

describe("QueueError", () => {
  it("is an Error that keeps the message the queue command prints", () => {
    const error = new QueueError("gh could not tell which repository this is");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("gh could not tell which repository this is");
  });

  it("is told apart from a plain Error, so the command reports only its own failures", () => {
    expect(new Error("unrelated")).not.toBeInstanceOf(QueueError);
  });
});
