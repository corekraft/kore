// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md
import { expect, test, vi } from "vitest";
import { otlpByName, otlpHostname } from "../config/index.js";
import { loadLocalCa } from "../security/index.js";
import { postOtlp, withForward } from "./otlp-forward.js";
import { postOtlpToName } from "./otlp-name.js";
import { sendSyntheticSignals } from "./otlp-send.js";
import { fakeRepository } from "./platform-support.js";

vi.mock("../config/index.js", () => ({
  otlpByName: vi.fn(),
  otlpHostname: vi.fn(),
}));
vi.mock("../security/index.js", () => ({ loadLocalCa: vi.fn() }));
vi.mock("./otlp-forward.js", () => ({
  postOtlp: vi.fn(),
  waitForOtlp: vi.fn(),
  withForward: vi.fn(),
}));
vi.mock("./otlp-name.js", () => ({ postOtlpToName: vi.fn() }));

const repository = fakeRepository();
const runner = {} as Parameters<typeof sendSyntheticSignals>[1];
const payloads = {
  traces: { t: 1 },
  logs: { l: 1 },
  metrics: { m: 1 },
};

test("with otlp-route on every signal is posted to the OTLP name over HTTPS, verified against the local CA, and no port-forward is opened", async () => {
  vi.mocked(otlpByName).mockReturnValue(true);
  vi.mocked(otlpHostname).mockReturnValue("otlp.platform.kore.internal");
  vi.mocked(loadLocalCa).mockResolvedValue("PEM");
  await sendSyntheticSignals(repository, runner, payloads);
  expect(loadLocalCa).toHaveBeenCalledWith(repository, runner);
  expect(postOtlpToName).toHaveBeenCalledTimes(3);
  expect(postOtlpToName).toHaveBeenCalledWith({
    url: "https://otlp.platform.kore.internal",
    ca: "PEM",
    signal: "traces",
    payload: payloads.traces,
  });
  expect(withForward).not.toHaveBeenCalled();
});

test("with otlp-route off the signals go through the loopback receiver on 4319 and no CA is read or name posted to", async () => {
  vi.mocked(otlpByName).mockReturnValue(false);
  await sendSyntheticSignals(repository, runner, payloads);
  expect(withForward).toHaveBeenCalledWith(
    {
      context: repository.environment.kubeContext,
      namespace: "observability",
      target: "deployment/otel-collector",
      remotePort: 4319,
    },
    expect.any(Function),
  );
  expect(loadLocalCa).not.toHaveBeenCalled();
  expect(postOtlpToName).not.toHaveBeenCalled();
  expect(postOtlp).not.toHaveBeenCalled();
});
