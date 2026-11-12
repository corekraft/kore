import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { terminateMatching } from "./processes.js";

// Unit tests run beside a live cluster: a default process listing that reached
// the host would SIGTERM a real host process (a live run once lost its
// Gateway port this way).
test("in unit tests, terminating by default listing never signals a real host process", async () => {
  const marker = `kore-isolation-${randomUUID()}`;
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 30000)", marker],
    {
      stdio: "ignore",
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stopped = await terminateMatching(
      (entry) => entry.command.includes(marker),
      (entry) => `stopped ${entry.pid}`,
      { report: () => undefined },
    );
    expect(stopped).toEqual([]);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  } finally {
    child.kill("SIGKILL");
  }
});
