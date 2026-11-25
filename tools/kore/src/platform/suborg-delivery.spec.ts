// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "../config/index.js";
import { koreRepositoryURL } from "./kore-repository.js";
import { composeSuborgDelivery } from "./suborg-delivery.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

// Issue 1553: with suborg-delivery-project on, every command that renders or installs the
// platform takes the Kore repository URL from the git origin, so the chart is never handed a
// repository whose URL was not composed. Off, nothing is read.

vi.mock("../config/index.js", () => ({
  featureEnabled: vi.fn(),
  suborgDeliveryProjectFlag: "suborg-delivery-project",
}));
vi.mock("./kore-repository.js", () => ({ koreRepositoryURL: vi.fn() }));

const repository = fakeRepository();
const { runner, run } = fakeRunner(() => "");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(koreRepositoryURL).mockResolvedValue(
    "https://github.com/corekraft/kore.git",
  );
});

test("with suborg-delivery-project off the repository is returned untouched and the origin is not read", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(await composeSuborgDelivery(repository, runner)).toBe(repository);
  expect(koreRepositoryURL).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("with suborg-delivery-project on the repository carries the Kore URL from the git origin, which the suborg projects need", async () => {
  expect(await composeSuborgDelivery(repository, runner)).toEqual({
    ...repository,
    suborgDelivery: { repoURL: "https://github.com/corekraft/kore.git" },
  });
  expect(koreRepositoryURL).toHaveBeenCalledWith(
    repository,
    runner,
    "the suborg AppProjects need",
  );
});

test("an origin that is refused stops the composition with the refusal, so nothing renders with no URL", async () => {
  vi.mocked(koreRepositoryURL).mockRejectedValue(new Error("not https"));
  await expect(composeSuborgDelivery(repository, runner)).rejects.toThrow(
    "not https",
  );
});
