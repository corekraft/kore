import { vi } from "vitest";

// No unit test may see, or signal, real host processes: unit tests run beside
// a live cluster, and a real listing would SIGTERM a real host process.
// `terminateMatching` resolves its default listing inside its own module, so
// replacing the `listHostProcesses` export alone does not reach it; wrap it
// too. A test that injects its own `listProcesses` still sees that.
vi.mock("./runtime/processes.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./runtime/processes.js")>();
  const noHostProcesses = async () => [];
  return {
    ...actual,
    listHostProcesses: noHostProcesses,
    terminateMatching: (
      ...[matches, describe, control = {}]: Parameters<
        typeof actual.terminateMatching
      >
    ) =>
      actual.terminateMatching(matches, describe, {
        listProcesses: noHostProcesses,
        ...control,
      }),
  };
});
