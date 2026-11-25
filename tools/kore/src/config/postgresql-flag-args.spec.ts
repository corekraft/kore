// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
import { beforeEach, expect, test, vi } from "vitest";
import { databaseRoleSplitArgs } from "./database-role-split-args.js";
import { postgresqlFlagArgs } from "./postgresql-flag-args.js";
import { serviceClassArgs } from "./service-class-args.js";
import type { Environment } from "./types.js";

vi.mock("./service-class-args.js", () => ({ serviceClassArgs: vi.fn() }));
vi.mock("./database-role-split-args.js", () => ({
  databaseRoleSplitArgs: vi.fn(),
}));

const environment = {} as unknown as Environment;

beforeEach(() => {
  vi.mocked(serviceClassArgs).mockReset();
  vi.mocked(databaseRoleSplitArgs).mockReset();
});

test("the service-class arguments come first, then the role-split arguments, for the same environment and component", () => {
  vi.mocked(serviceClassArgs).mockReturnValue(["--set", "a=1"]);
  vi.mocked(databaseRoleSplitArgs).mockReturnValue(["--set", "b=2"]);

  expect(postgresqlFlagArgs(environment, "kore-postgresql-api")).toEqual([
    "--set",
    "a=1",
    "--set",
    "b=2",
  ]);
  expect(serviceClassArgs).toHaveBeenCalledWith(
    environment,
    "kore-postgresql-api",
  );
  expect(databaseRoleSplitArgs).toHaveBeenCalledWith(
    environment,
    "kore-postgresql-api",
  );
});

test("no argument is added when neither underlying function passes one", () => {
  vi.mocked(serviceClassArgs).mockReturnValue([]);
  vi.mocked(databaseRoleSplitArgs).mockReturnValue([]);

  expect(postgresqlFlagArgs(environment, "kore-postgresql-rbac")).toEqual([]);
});
