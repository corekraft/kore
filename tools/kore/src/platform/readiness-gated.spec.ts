import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import { waitFor } from "./readiness.js";
import {
  component,
  fakeRunner,
  primeReadinessFakes,
  repository,
  tails,
} from "./readiness-support.js";

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

test("a flag-gated readiness resource is checked only while its flag is on, and the rest always are", async () => {
  const gated = "clusterimagepolicy.policy.sigstore.dev/kore-template-images";
  const always = "clusterimagepolicy.policy.sigstore.dev/kore-platform-images";
  const flagged = component({
    readiness: [always, gated],
    readinessFlags: { [gated]: "golden-path-template-admission" },
  });
  const asRepository = (features: Record<string, boolean>) =>
    ({
      ...repository,
      environment: { ...repository.environment, features },
    }) as unknown as Repository;

  const off = fakeRunner();
  await waitFor(asRepository({}), off.runner, flagged);
  expect(tails(off.run)).toEqual([
    ["--for=condition=Ready", always, "--timeout=10m"],
  ]);
  expect(
    off.run.mock.calls.map((call) => (call[1] as string[]).join(" ")),
  ).not.toContainEqual(expect.stringContaining(gated));

  const on = fakeRunner();
  await waitFor(
    asRepository({ "golden-path-template-admission": true }),
    on.runner,
    flagged,
  );
  expect(
    on.run.mock.calls.map((call) => (call[1] as string[]).join(" ")),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining(always),
      expect.stringContaining(gated),
    ]),
  );
});
