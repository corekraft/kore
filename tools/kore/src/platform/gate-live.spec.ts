// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { expect, test, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import {
  bootstrap,
  bootstrapUser,
  canI,
  developer,
  evidenceObject,
  evidenceScope,
  gateObject,
  kubectl,
  type Live,
} from "./gate-live.js";
import { repositoryOf, runnerFake } from "./gate-unit-support.js";

vi.mock("./admission-gate.js");
vi.mock("./readiness-manifest.js");

const repository = repositoryOf({ kubeContext: "k3d-kore-local" });

function cluster(
  reply: Parameters<typeof runnerFake>[0] = () => ({
    stdout: "",
    stderr: "",
    code: 0,
  }),
) {
  const { run, runner } = runnerFake(reply);
  const live: Live = { repository, runner };
  return { run, live };
}

test("kubectl runs the configured context and returns the trimmed output as ok", async () => {
  const { run, live } = cluster(() => ({
    stdout: "  pod/web\n",
    stderr: "",
    code: 0,
  }));

  const result = await kubectl(live, ["get", "pods"]);

  expect(result).toEqual({ ok: true, output: "pod/web" });
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-local", "get", "pods"],
    { capture: true },
  );
});

test("kubectl passes its input through only when one is given", async () => {
  const { run, live } = cluster();

  await kubectl(live, ["apply", "--filename=-"], '{"kind":"List"}');

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-local", "apply", "--filename=-"],
    { capture: true, input: '{"kind":"List"}' },
  );
});

test("a failed kubectl is reported as not ok with its trimmed stderr, never thrown", async () => {
  const { live } = cluster(() => {
    throw new CommandError("kubectl", ["get"], {
      stdout: "",
      stderr: "  Error from server (Forbidden)\n",
      code: 1,
    });
  });

  await expect(kubectl(live, ["get", "pods"])).resolves.toEqual({
    ok: false,
    output: "Error from server (Forbidden)",
  });
});

test("an error that is not a failed command is rethrown, not read as a refusal", async () => {
  const broken = new Error("spawn kubectl ENOENT");
  const { live } = cluster(() => {
    throw broken;
  });

  await expect(kubectl(live, ["get", "pods"])).rejects.toBe(broken);
});

test("canI asks as the identity and answers true only when the output starts with yes", async () => {
  const { run, live } = cluster(() => ({
    stdout: "yes",
    stderr: "",
    code: 0,
  }));

  const allowed = await canI(
    live,
    ["--as", "kore-gate-developer"],
    ["create", "pods", "-n", "app"],
  );

  expect(allowed).toBe(true);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--as",
      "kore-gate-developer",
      "auth",
      "can-i",
      "create",
      "pods",
      "-n",
      "app",
    ],
    { capture: true },
  );
});

test("canI answers false for a no, and for a refusal to answer", async () => {
  const refused = cluster(() => ({
    stdout: "no",
    stderr: "",
    code: 0,
  }));
  const failed = cluster(() => {
    throw new CommandError("kubectl", ["auth"], {
      stdout: "",
      stderr: "error: unknown identity",
      code: 1,
    });
  });

  await expect(canI(refused.live, [], ["get", "pods"])).resolves.toBe(false);
  await expect(canI(failed.live, [], ["get", "pods"])).resolves.toBe(false);
});

test("the live proof's identities and object names are the ones the gate is written with", () => {
  expect(bootstrap).toEqual([
    "--as",
    "kore-gate-bootstrap",
    "--as-group",
    "kore:bootstrap",
  ]);
  expect(bootstrap).toContain(bootstrapUser);
  expect(developer).toEqual([
    "--as",
    "kore-gate-developer",
    "--as-group",
    "kore:developers",
  ]);
  expect(gateObject).toBe(
    "koreapplicationadmission.constraints.gatekeeper.sh/kore-application-admission",
  );
  expect(evidenceObject).toBe("configmaps/kore-platform-readiness");
  expect(evidenceScope).toEqual(["-n", "kore-system"]);
});
