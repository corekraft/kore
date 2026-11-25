import { beforeEach, expect, test, vi } from "vitest";
import {
  checkAppRecords,
  checkCrossFileRules as cf,
  checkOrganizationRecords,
  orderedComponents,
} from "../config/index.js";
import { managedLockErrors } from "../images/index.js";
import { validatePortability } from "../diagnostics/index.js";
import { validateCommand } from "./commands-read.js";
import { fakeContext, fakeRepository } from "./cli-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("../diagnostics/index.js");
vi.mock("../runtime/index.js");
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository({ name: "local" });

beforeEach(() => {
  vi.mocked(orderedComponents).mockReturnValue([
    { name: "gateway" },
    { name: "registry" },
  ] as never);
  vi.mocked(validatePortability).mockResolvedValue({
    applications: ["reference"],
  } as never);
  vi.mocked(cf).mockResolvedValue({ errors: [], warnings: [] });
  vi.mocked(managedLockErrors).mockReturnValue([]);
  vi.mocked(checkAppRecords).mockResolvedValue({ errors: [], warnings: [] });
  vi.mocked(checkOrganizationRecords).mockResolvedValue({
    errors: [],
    organizations: [],
  });
});

test("validate tells the app record check that a backup target is declared only when the overlay declares backup", async () => {
  const declared = fakeRepository({
    name: "local",
    backup: {
      target: { bucket: "kore-backups" },
      retention: { daily: 14 },
      schedule: "03:00",
    },
  });
  await validateCommand(
    fakeContext({ command: "validate", repository: declared }),
  );
  expect(checkAppRecords).toHaveBeenLastCalledWith(
    expect.objectContaining({ backupTarget: true }),
  );
  await validateCommand(fakeContext({ command: "validate", repository }));
  expect(checkAppRecords).toHaveBeenLastCalledWith(
    expect.objectContaining({ backupTarget: false }),
  );
});
