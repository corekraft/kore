// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { lookup } from "node:dns/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { registryByName, registryHostname } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { fakeRepository, fakeRunner } from "./images-support.js";
import { registryRequest } from "./registry-https.js";
import {
  ensureRegistryName,
  forwardAddress,
  hostRegistryAddress,
  registryNameProblem,
} from "./registry-name.js";
import { loadRegistryCa } from "./registry-tls.js";

vi.mock("node:dns/promises");
vi.mock("../config/index.js");
vi.mock("./registry-https.js");
vi.mock("./registry-tls.js");

const name = "registry.platform.kore.internal";
const repository = fakeRepository();

/** A failure carrying the code Node's resolver and TLS stack put on theirs. */
function failure(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

function answers(status: number) {
  vi.mocked(registryRequest).mockResolvedValue({
    status,
    headers: {},
    body: "",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(registryByName).mockReturnValue(true);
  vi.mocked(registryHostname).mockReturnValue(name);
  vi.mocked(loadRegistryCa).mockResolvedValue("ca-pem");
  vi.mocked(lookup).mockResolvedValue({ address: "127.0.0.1", family: 4 });
  answers(401);
});

test("a k3d registry is dialed by its name, with no port, whether or not registry-by-name is on", () => {
  vi.mocked(registryByName).mockReturnValue(false);
  expect(hostRegistryAddress(repository.environment)).toBe(name);
});

test("a managed environment keeps the tailnet forward's address while registry-by-name is off", () => {
  vi.mocked(registryByName).mockReturnValue(false);
  expect(
    hostRegistryAddress({ ...repository.environment, provider: "managed" }),
  ).toBe(forwardAddress);
  expect(forwardAddress).toBe("127.0.0.1:30500");
});

test("the host reaches the registry by its name, with no port, while registry-by-name is on", () => {
  expect(hostRegistryAddress(repository.environment)).toBe(name);
});

test("a name that resolves and answers /v2/ with the registry's own certificate has no problem, even for the 401 that asks for credentials", async () => {
  const { runner } = fakeRunner();
  await expect(
    registryNameProblem(repository, runner),
  ).resolves.toBeUndefined();
  expect(lookup).toHaveBeenCalledWith(name);
  expect(registryRequest).toHaveBeenCalledWith(
    "GET",
    `https://${name}/v2/`,
    {},
    "ca-pem",
  );
});

test("a name that does not resolve is named, with the flag and the commands that make it resolve", async () => {
  vi.mocked(lookup).mockRejectedValue(failure("ENOTFOUND"));
  const { runner } = fakeRunner();
  await expect(registryNameProblem(repository, runner)).resolves.toBe(
    `${name} does not resolve (ENOTFOUND); turn on platform-dns, run \`kore dns install --environment local\`, then \`kore local up\` so the platform DNS answers it`,
  );
  expect(registryRequest).not.toHaveBeenCalled();
});

test("a Gateway that refuses connections on 443 names the missing loopback mapping", async () => {
  vi.mocked(registryRequest).mockRejectedValue(failure("ECONNREFUSED"));
  const { runner } = fakeRunner();
  await expect(registryNameProblem(repository, runner)).resolves.toBe(
    `nothing answers ${name} on port 443 (ECONNREFUSED); turn on platform-dns, which publishes the 443 mapping, and recreate a local cluster created without it with \`kore local down --prune\`, then \`kore local up\``,
  );
});

test("a certificate the registry's CA did not issue means the Gateway does not route the name to the registry", async () => {
  vi.mocked(registryRequest).mockRejectedValue(
    failure("UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
  );
  const { runner } = fakeRunner();
  await expect(registryNameProblem(repository, runner)).resolves.toBe(
    `${name} is answered with a certificate the registry's CA did not issue (UNABLE_TO_VERIFY_LEAF_SIGNATURE), so the shared Gateway does not pass it through to the registry; check that TLSRoute oci-registry in kore-registry is Accepted by the listener tls-registry on kore-system/kore-gateway, and run \`kore platform up --env local\``,
  );
});

test("a connection the Gateway drops means the same missing route", async () => {
  vi.mocked(registryRequest).mockRejectedValue(failure("ECONNRESET"));
  const { runner } = fakeRunner();
  await expect(registryNameProblem(repository, runner)).resolves.toBe(
    `${name} is answered with a connection that closes (ECONNRESET), so the shared Gateway holds no route for it; check that TLSRoute oci-registry in kore-registry is Accepted by the listener tls-registry on kore-system/kore-gateway, and run \`kore platform up --env local\``,
  );
});

test("a registry certificate without the name is named, and kore local up restarts the proxy to serve the reissued one", async () => {
  vi.mocked(registryRequest).mockRejectedValue(
    failure("ERR_TLS_CERT_ALTNAME_INVALID"),
  );
  const { runner, run } = fakeRunner();
  await expect(registryNameProblem(repository, runner)).resolves.toBe(
    `the registry's certificate does not carry ${name} (ERR_TLS_CERT_ALTNAME_INVALID); cert-manager reissues it once registry-by-name is on, and \`kore local up\` restarts the registry proxy to serve it`,
  );
  expect(run).not.toHaveBeenCalled();
});

test("a certificate that gained the name restarts the registry proxy in the environment's context, waits for it, and checks the name again", async () => {
  vi.mocked(registryRequest)
    .mockRejectedValueOnce(failure("ERR_TLS_CERT_ALTNAME_INVALID"))
    .mockResolvedValueOnce({ status: 401, headers: {}, body: "" });
  const { runner, run } = fakeRunner();
  await expect(ensureRegistryName(repository, runner)).resolves.toBeUndefined();
  expect(run.mock.calls).toEqual([
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "kore-registry",
        "rollout",
        "restart",
        "deployment/oci-registry",
      ],
    ],
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "kore-registry",
        "rollout",
        "status",
        "deployment/oci-registry",
        "--timeout=2m",
      ],
    ],
  ]);
  expect(registryRequest).toHaveBeenCalledTimes(2);
});

test("a registry proxy whose new pod never becomes ready fails naming the deployment, namespace, context, the likely cause and how to inspect the pod, and checks the name no further", async () => {
  vi.mocked(registryRequest).mockRejectedValue(
    failure("ERR_TLS_CERT_ALTNAME_INVALID"),
  );
  const { runner, run } = fakeRunner();
  const timedOut = new CommandError(
    "kubectl",
    ["rollout", "status", "deployment/oci-registry", "--timeout=2m"],
    {
      stdout: "",
      stderr: "error: timed out waiting for the condition",
      code: 1,
    },
  );
  run
    .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 })
    .mockRejectedValueOnce(timedOut);
  await expect(ensureRegistryName(repository, runner)).rejects.toThrow(
    new Error(
      "deployment/oci-registry in kore-registry on context k3d-kore-local did not finish rolling out within 2m after the restart (error: timed out waiting for the condition). The likely cause is that the new registry pod is not Ready; inspect it with `kubectl --context k3d-kore-local --namespace kore-registry describe pod -l app.kubernetes.io/name=oci-registry`, then run `kore local up` again",
    ),
  );
  expect(run).toHaveBeenCalledTimes(2);
  expect(registryRequest).toHaveBeenCalledTimes(1);
});

test("a certificate that still lacks the name after the proxy restarts names the Certificate to check, and does not restart again", async () => {
  vi.mocked(registryRequest).mockRejectedValue(
    failure("ERR_TLS_CERT_ALTNAME_INVALID"),
  );
  const { runner, run } = fakeRunner();
  await expect(ensureRegistryName(repository, runner)).rejects.toThrow(
    new Error(
      `${name} is still missing from the registry's certificate after the registry proxy restarted (ERR_TLS_CERT_ALTNAME_INVALID); the proxy serves the certificate it read, so check that Certificate oci-registry-tls in kore-registry is Ready on context k3d-kore-local, then run \`kore local up\` again`,
    ),
  );
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]?.[1]).toContain("restart");
});

test("a name the registry already serves restarts nothing", async () => {
  const { runner, run } = fakeRunner();
  await expect(ensureRegistryName(repository, runner)).resolves.toBeUndefined();
  expect(run).not.toHaveBeenCalled();
});

test("a problem other than a missing name is reported as is, and the proxy is not restarted", async () => {
  vi.mocked(registryRequest).mockRejectedValue(failure("ECONNREFUSED"));
  const { runner, run } = fakeRunner();
  await expect(ensureRegistryName(repository, runner)).rejects.toThrow(
    new Error(
      `nothing answers ${name} on port 443 (ECONNREFUSED); turn on platform-dns, which publishes the 443 mapping, and recreate a local cluster created without it with \`kore local down --prune\`, then \`kore local up\``,
    ),
  );
  expect(run).not.toHaveBeenCalled();
});

test("an unexpected status from the registry name is reported with the status", async () => {
  answers(404);
  const { runner } = fakeRunner();
  await expect(registryNameProblem(repository, runner)).resolves.toBe(
    `${name} answered /v2/ with HTTP 404, not the registry's 200 or 401; something other than the registry answers the name`,
  );
});

test("an error with no code is rethrown, not reported as a cause", async () => {
  vi.mocked(registryRequest).mockRejectedValue(new Error("boom"));
  const { runner } = fakeRunner();
  await expect(registryNameProblem(repository, runner)).rejects.toThrow("boom");
});

test("an environment that does not reach the registry by name is never probed", async () => {
  vi.mocked(registryByName).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  await expect(
    registryNameProblem(repository, runner),
  ).resolves.toBeUndefined();
  expect(lookup).not.toHaveBeenCalled();
  expect(registryRequest).not.toHaveBeenCalled();
  expect(loadRegistryCa).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("ensuring the name throws the problem as an error, and does nothing when there is none", async () => {
  const { runner } = fakeRunner();
  await expect(ensureRegistryName(repository, runner)).resolves.toBeUndefined();
  vi.mocked(lookup).mockRejectedValue(failure("ENOTFOUND"));
  await expect(ensureRegistryName(repository, runner)).rejects.toThrow(
    /^registry\.platform\.kore\.internal does not resolve \(ENOTFOUND\)/,
  );
});
