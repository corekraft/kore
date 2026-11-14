import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { dispatch } from "../src/cli/cli-dispatch.fixtures.js";

vi.mock("../src/app/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).appModule(),
);
vi.mock("../src/cluster/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).clusterModule(),
);
vi.mock("../src/config/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).configModule(),
);
vi.mock("../src/diagnostics/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).diagnosticsModule(),
);
vi.mock("../src/runtime/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).runtimeModule(),
);
vi.mock("../src/platform/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).platformModule(),
);
vi.mock("../src/security/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).securityModule(),
);
vi.mock("../src/local/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).localModule(),
);

vi.mock("../src/images/index.js", () => ({
  managedLockErrors: vi.fn((lock: { bad?: boolean }) =>
    lock.bad ? ["grafana: mirror digest sha256:0 differs"] : [],
  ),
}));

import { main } from "../src/cli/cli.js";

let directory: string;

beforeEach(async () => {
  dispatch.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  directory = await mkdtemp(join(tmpdir(), "kore-lock-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function lockFile(content: unknown): Promise<string> {
  const path = join(directory, "platform-images.lock.json");
  await writeFile(path, JSON.stringify(content));
  return path;
}

test("validate checks a downloaded platform image lock against the environment, read-only", async () => {
  const path = await lockFile({ version: 1 });
  expect(
    await main([
      "validate",
      "--environment",
      "managed-example",
      "--platform-image-lock",
      path,
      "--json",
    ]),
  ).toBe(0);
  expect(dispatch).toEqual(["validatePortability"]);
});

test("validate fails and names every lock problem when the lock does not match", async () => {
  const path = await lockFile({ bad: true });
  await expect(
    main(["validate", "--platform-image-lock", path]),
  ).rejects.toThrow(/grafana: mirror digest/);
});

test("validate names the file when the lock is not JSON", async () => {
  const path = join(directory, "broken.json");
  await writeFile(path, "not json");
  await expect(
    main(["validate", "--platform-image-lock", path]),
  ).rejects.toThrow(/broken\.json/);
});
