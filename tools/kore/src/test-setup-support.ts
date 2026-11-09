import { vi } from "vitest";

// No unit test may see, or signal, real host processes: the default process
// listing is empty unless a test injects its own `listProcesses`.
vi.mock("./runtime/processes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runtime/processes.js")>()),
  listHostProcesses: async () => [],
}));
