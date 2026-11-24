// The `platform uninstall` action of the infra command: it names the release by
// its positional argument and passes the consent flags on. Kept apart from the
// infra spec, which is at its line budget.
import { beforeEach, expect, test, vi } from "vitest";
import { uninstallGatedRelease } from "../platform/index.js";
import { platformCommand } from "./commands-infra.js";
import { actionsOf, flags } from "./commands-infra-support.js";
import { mutateAction } from "./context.js";
import { print } from "./output.js";
import {
  fakeContext,
  fakeRepository,
  parsedArgs,
  sharedRunner,
} from "./cli-support.js";

vi.mock("../app/index.js");
vi.mock("../cluster/index.js");
vi.mock("../platform/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./image-lock-flag.js");
vi.mock("./output.js");

beforeEach(() => {
  vi.clearAllMocks();
  flags({});
  vi.mocked(mutateAction).mockResolvedValue(0);
});

test("platform uninstall names the release by its positional argument and passes --yes and --purge-data on", async () => {
  flags({ yes: true, "purge-data": true });
  const parsed = parsedArgs({}, ["registry"]);
  await platformCommand(
    fakeContext({ command: "platform", action: "uninstall", parsed }),
  );
  await actionsOf().uninstall!(fakeContext({ parsed }), sharedRunner);
  expect(uninstallGatedRelease).toHaveBeenCalledWith(
    fakeRepository(),
    sharedRunner,
    "registry",
    { yes: true, purgeData: true },
  );
});

test("platform uninstall without --yes passes no consent on, so the uninstall refuses to remove anything", async () => {
  const parsed = parsedArgs({}, ["registry"]);
  await platformCommand(
    fakeContext({ command: "platform", action: "uninstall", parsed }),
  );
  await actionsOf().uninstall!(fakeContext({ parsed }), sharedRunner);
  expect(uninstallGatedRelease).toHaveBeenCalledWith(
    fakeRepository(),
    sharedRunner,
    "registry",
    { yes: false, purgeData: false },
  );
});

test("platform uninstall prints the result, whether it removed the release or found it already gone", async () => {
  const result = {
    status: "absent",
    name: "registry",
    namespace: "registry-ns",
  } as const;
  vi.mocked(uninstallGatedRelease).mockResolvedValue(result);
  const parsed = parsedArgs({}, ["registry"]);
  await platformCommand(
    fakeContext({ command: "platform", action: "uninstall", parsed }),
  );
  await actionsOf().uninstall!(fakeContext({ parsed }), sharedRunner);
  expect(print).toHaveBeenCalledWith(result, false);
});

test("platform uninstall without a component name is refused before any uninstall runs", async () => {
  await platformCommand(
    fakeContext({ command: "platform", action: "uninstall" }),
  );
  await expect(
    actionsOf().uninstall!(fakeContext({ parsed: parsedArgs() }), sharedRunner),
  ).rejects.toThrow(
    "platform uninstall requires the component name: kore platform uninstall <component> --environment <name> [--yes] [--purge-data]",
  );
  expect(uninstallGatedRelease).not.toHaveBeenCalled();
});
