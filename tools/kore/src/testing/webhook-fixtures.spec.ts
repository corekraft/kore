import { expect, test, vi } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import { registryTlsSecret } from "./registry-tls-fixtures.js";
import {
  gatedOffReleaseAbsent,
  withHealthyWebhooks,
} from "./webhook-fixtures.js";

test("the local cluster runs metrics-server, so its release status is not answered not found", () => {
  expect(() =>
    gatedOffReleaseAbsent("helm", [
      "status",
      "metrics-server",
      "--namespace",
      "metrics-server",
      "--kube-context",
      "k3d-kore-local",
    ]),
  ).not.toThrow();
});

test("a cluster that is not local, where autoscaling-defaults is off, answers metrics-server not found", () => {
  expect(() =>
    gatedOffReleaseAbsent("helm", [
      "status",
      "metrics-server",
      "--namespace",
      "metrics-server",
      "--kube-context",
      "REQUIRED",
    ]),
  ).toThrow(CommandError);
});

test("a release the local overlay gates off is still answered not found, so its flag-off path holds", () => {
  expect(() =>
    gatedOffReleaseAbsent("helm", [
      "status",
      "argocd",
      "--namespace",
      "argocd",
    ]),
  ).toThrow(CommandError);
});

/** A healthy-webhook wrapper over a wrapped runner that answers every call with `passed through`. */
function wrapped() {
  const run = vi.fn<Runner["run"]>(async () => ({
    stdout: "passed through",
    stderr: "",
    code: 0,
  }));
  return { run, healthy: withHealthyWebhooks({ run }) };
}

test("a webhook configuration read answers healthy without reaching the wrapped runner", async () => {
  const { run, healthy } = wrapped();

  const result = await healthy.run("kubectl", [
    "get",
    "validatingwebhookconfiguration/kore",
  ]);

  expect(result).toEqual({ stdout: '{"webhooks":[]}', stderr: "", code: 0 });
  expect(run).not.toHaveBeenCalled();
});

test("the registry trust read answers with the CA-issued registry TLS secret", async () => {
  const { run, healthy } = wrapped();

  const result = await healthy.run("kubectl", [
    "get",
    "secret",
    "oci-registry-tls",
    "-o",
    "yaml",
  ]);

  expect(result).toEqual({ stdout: registryTlsSecret, stderr: "", code: 0 });
  expect(run).not.toHaveBeenCalled();
});

test("a command that is not a kubectl read passes through to the wrapped runner unchanged", async () => {
  const { run, healthy } = wrapped();

  const result = await healthy.run("helm", ["status", "kore-platform-config"]);

  expect(result).toEqual({ stdout: "passed through", stderr: "", code: 0 });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toBe("helm");
});
