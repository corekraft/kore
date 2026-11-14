import { expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { registryTlsSecret } from "./registry-tls-fixtures.js";
import { withHealthyWebhooks } from "./webhook-fixtures.js";

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
