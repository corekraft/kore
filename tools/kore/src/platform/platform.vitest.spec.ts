import { describe, expect, it, vi } from "vitest";
import { loadRepository } from "../config/index.js";
import { platformUp } from "./platform.js";

describe("platform safety boundaries", () => {
  it("does not start Minikube when the configured context identifies another cluster", async () => {
    const repository = await loadRepository("local");
    const run = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "minikube" && args[0] === "status") {
        return { stdout: '{"Host":"Running"}', stderr: "", code: 0 };
      }
      if (command === "kubectl") {
        return { stdout: "wrong-cluster", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });

    await expect(platformUp(repository, { run })).rejects.toThrow(
      /expected cluster|context/i,
    );
    expect(run).not.toHaveBeenCalledWith(
      "minikube",
      expect.arrayContaining(["start"]),
      expect.anything(),
    );
  });
});
