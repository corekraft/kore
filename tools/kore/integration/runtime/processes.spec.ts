import { expect, test, vi } from "vitest";

// The one process-listing test that needs a real host: `ps` lists this very test
// process. The termination cases inject their own listing and live in the unit spec
// src/runtime/processes.spec.ts.
test("lists host processes with pid and full command line", async () => {
  const { listHostProcesses } = await vi.importActual<
    typeof import("../../src/runtime/processes.js")
  >("../../src/runtime/processes.js");
  const entries = await listHostProcesses();
  const self = entries.find((entry) => entry.pid === process.pid);
  expect(self?.command).toContain("node");
});
