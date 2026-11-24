import { loadRepository } from "../config/index.js";
import { describe, expect, it, vi } from "vitest";

import { runningK3d } from "./k3d-fixtures.js";
import { platformUp } from "./up.js";

describe("platform safety boundaries", () => {
  it("does not start the k3d cluster when the configured context identifies another cluster", async () => {
    const loaded = await loadRepository("local");
    // This test is about the context boundary, not the drift check: turn the
    // drift-listing-mappings flag off so the faked k3d listing is not read for mappings.
    const repository = {
      ...loaded,
      environment: {
        ...loaded.environment,
        features: {
          ...loaded.environment.features,
          "drift-listing-mappings": false,
        },
      },
    };
    const run = vi.fn(async (command: string) => {
      if (command === "k3d") {
        return runningK3d();
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
      "k3d",
      expect.arrayContaining(["start"]),
      expect.anything(),
    );
    expect(run).not.toHaveBeenCalledWith(
      "k3d",
      expect.arrayContaining(["create"]),
      expect.anything(),
    );
  });
});
