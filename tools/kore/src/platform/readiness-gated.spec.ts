import { beforeEach, expect, test, vi } from "vitest";
import { readinessGatedOff } from "../config/index.js";
import { waitFor } from "./readiness.js";
import { foreignCertificateResources } from "./readiness-issuer.js";
import {
  component,
  fakeRunner,
  primeReadinessFakes,
  repository,
  tails,
} from "./readiness-support.js";

vi.mock("../config/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/index.js")>()),
  readinessGatedOff: vi.fn(),
}));
vi.mock("./probe.js");
vi.mock("./readiness-custom.js");
vi.mock("./readiness-issuer.js");
vi.mock("./readiness-daemonset.js");
vi.mock("./readiness-webhook.js");
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
  failureAcrossBounds: vi.fn(),
  pause: vi.fn(),
  timeoutMilliseconds: vi.fn(),
  retryBudget: vi.fn(),
}));

beforeEach(primeReadinessFakes);
// The foreign names are read from the records, and none of these fixtures names one.
beforeEach(() => {
  vi.mocked(foreignCertificateResources).mockReturnValue([]);
});

const gated = "clusterimagepolicy.policy.sigstore.dev/kore-template-images";
const always = "clusterimagepolicy.policy.sigstore.dev/kore-platform-images";
const flagged = component({
  readiness: [always, gated],
  readinessFlags: { [gated]: "golden-path-template-admission" },
});

/** Stubs the gate: the flagged resource is off when `off`, every other resource is never gated. */
function gateOff(off: boolean): void {
  vi.mocked(readinessGatedOff).mockImplementation(
    (_environment, _component, resource) => off && resource === gated,
  );
}

test("with the gated resource's flag off, waitFor skips it and checks only the ungated resource", async () => {
  gateOff(true);
  const fake = fakeRunner();

  await waitFor(repository, fake.runner, flagged);

  expect(readinessGatedOff).toHaveBeenCalledWith(
    repository.environment,
    flagged,
    gated,
  );
  expect(tails(fake.run)).toEqual([
    ["--for=condition=Ready", always, "--timeout=10m"],
  ]);
  expect(
    fake.run.mock.calls.flatMap((call) => call[1] as string[]),
  ).not.toContain(gated);
});

test("with the gated resource's flag on, waitFor checks both resources, the gated one too", async () => {
  gateOff(false);
  const fake = fakeRunner();

  await waitFor(repository, fake.runner, flagged);

  expect(tails(fake.run)).toEqual([
    ["--for=condition=Ready", always, "--timeout=10m"],
    ["--for=condition=Ready", gated, "--timeout=10m"],
  ]);
});
