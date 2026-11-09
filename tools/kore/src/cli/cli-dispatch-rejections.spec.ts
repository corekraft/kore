import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { dispatch } from "./cli-dispatch.fixtures.js";

vi.mock("../app/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).appModule(),
);
vi.mock("../cluster/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).clusterModule(),
);
vi.mock("../config/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).configModule(),
);
vi.mock("../diagnostics/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).diagnosticsModule(),
);
vi.mock("../runtime/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).runtimeModule(),
);
vi.mock("../images/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).imagesModule(),
);
vi.mock("../platform/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).platformModule(),
);
vi.mock("../security/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).securityModule(),
);
vi.mock("../tunnel/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).tunnelModule(),
);
vi.mock("../local/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).localModule(),
);

import { main } from "./cli.js";

beforeEach(() => {
  dispatch.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("CLI rejects unknown commands, missing environments, and unsupported actions", async () => {
  await expect(main(["unrecognized"])).rejects.toThrow(/unknown command/);
  await expect(
    main(["cluster", "nope", "--environment", "local"]),
  ).rejects.toThrow(/unknown cluster action/);
  await expect(
    main(["platform", "nope", "--environment", "local"]),
  ).rejects.toThrow(/unknown platform action/);
  await expect(
    main(["app", "publish", "reference", "--environment", "local"]),
  ).rejects.toThrow(/unknown app action/);
  await expect(
    main(["local", "restart", "--environment", "local"]),
  ).rejects.toThrow(/unknown local action/);
  await expect(
    main(["tunnel", "restart", "--environment", "local"]),
  ).rejects.toThrow(/unknown tunnel action/);
  await expect(
    main(["secrets", "rotate", "--environment", "local"]),
  ).rejects.toThrow(/unknown secrets action/);
  await expect(
    main(["trust", "remove", "--environment", "local"]),
  ).rejects.toThrow(/unknown trust action/);
  await expect(
    main(["app", "status", "--environment", "local"]),
  ).rejects.toThrow(/application name is required/);
  await expect(main(["app", "up", "reference"])).rejects.toThrow(
    /--environment is required for mutating commands/,
  );
});

test("data commands require an environment, and restore requires --from", async () => {
  await expect(main(["data", "export"])).rejects.toThrow(
    /--environment is required for mutating commands/,
  );
  await expect(
    main(["data", "restore", "--environment", "local"]),
  ).rejects.toThrow(/--from/);
  expect(dispatch).not.toContain("restoreRetainedData");
});

test("unknown actions fail before taking the lock or writing a journal entry", async () => {
  for (const argv of [
    ["cluster", "nope"],
    ["platform", "nope"],
    ["app", "restart", "reference"],
    ["local", "restart"],
    ["tunnel", "restart"],
    ["secrets", "rotate"],
    ["trust", "remove"],
    ["registry", "rotate"],
  ]) {
    dispatch.length = 0;
    await expect(main([...argv, "--environment", "local"])).rejects.toThrow(
      /unknown \w+ action/,
    );
    expect(dispatch, argv.join(" ")).toEqual([]);
  }
});

test("registry rotate-credentials requires a named environment", async () => {
  await expect(
    main(["registry", "rotate-credentials", "--yes"]),
  ).rejects.toThrow(/--environment is required for mutating commands/);
  expect(dispatch).toEqual([]);
});
