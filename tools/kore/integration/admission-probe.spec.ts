import { loadRepository } from "../src/config/index.js";
import assert from "node:assert/strict";
import { test } from "vitest";

import { healthyRunner, type Call } from "../src/testing/index.js";
import { CommandError, type Runner } from "../src/runtime/index.js";
import {
  admissionVerdict,
  deployedImage,
  publishSignedCopy,
  publishUntrustedCopies,
  scaleDeployment,
} from "../src/platform/admission-probe.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Helpers for the opt-in live admission specs; fast tests fake the runner.

const source = `10.96.0.50:5000/reference@sha256:${"c".repeat(64)}`;
const copiedDigest = `sha256:${"d".repeat(64)}`;

function denied(stderr: string): CommandError {
  return new CommandError("kubectl", [], { stdout: "", stderr, code: 1 });
}

test("a server dry run of an admitted pod reports admitted, creating nothing", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args });
      assert.equal(command, "kubectl");
      assert.match(options?.input ?? "", /"kind":"Pod"/);
      return { stdout: "pod/x created (server dry run)", stderr: "", code: 0 };
    },
  };

  const verdict = await admissionVerdict(
    repository,
    runner,
    "reference",
    source,
  );

  assert.equal(verdict.admitted, true);
  const args = calls[0]!.args;
  assert.ok(args.includes("--dry-run=server"));
  assert.deepEqual(args.slice(0, 4), [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "reference",
  ]);
});

test("a webhook denial is reported as not admitted with the verifier's message", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run() {
      throw denied(
        'admission webhook "policy.sigstore.dev" denied the request: no signatures found',
      );
    },
  };

  const verdict = await admissionVerdict(
    repository,
    runner,
    "reference",
    source,
  );

  assert.equal(verdict.admitted, false);
  assert.match(verdict.detail, /no signatures found/);
});

test("an unexpected failure is rethrown, never read as a denial", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run() {
      throw new Error("spawn kubectl ENOENT");
    },
  };

  await assert.rejects(
    admissionVerdict(repository, runner, "reference", source),
    /ENOENT/,
  );
});

test("a failed dry run that is not an admission denial is not read as one", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run() {
      throw denied("Unable to connect to the server: connection refused");
    },
  };

  await assert.rejects(
    admissionVerdict(repository, runner, "reference", source),
    /connection refused/,
  );
});

test("the deployed kore-signed image is read from the enrolled namespace", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return { stdout: `${source}\n`, stderr: "", code: 0 };
    },
  };

  assert.equal(await deployedImage(repository, runner, "reference"), source);
  assert.ok(calls[0]!.args.includes("--namespace"));
  assert.ok(calls[0]!.args.includes("reference"));
});

test("no deployed image fails with the fix instead of probing nothing", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run() {
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await assert.rejects(
    deployedImage(repository, runner, "reference"),
    /kore app up reference/,
  );
});

test("untrusted copies are pushed with the push identity and one is signed with a throwaway key", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const inputs: string[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const base = healthyRunner(calls);
  const runner: Runner = {
    async run(command, args, options) {
      if (options?.input !== undefined) {
        inputs.push(options.input);
      }
      if (options?.env) {
        envs.push(options.env);
      }
      return await base.run(command, args, options);
    },
  };

  const copies = await publishUntrustedCopies(repository, runner, source, {
    registry: { isPortOpen: async () => true },
    digest: async () => copiedDigest,
  });

  assert.equal(
    copies.unsigned,
    `10.96.0.50:5000/kore-admission-probe/unsigned@${copiedDigest}`,
  );
  assert.equal(
    copies.foreignSigned,
    `10.96.0.50:5000/kore-admission-probe/foreign-signed@${copiedDigest}`,
  );
  const pushes = calls.filter(
    ({ command, args }) => command === "docker" && args[0] === "exec",
  );
  assert.equal(pushes.length, 2);
  for (const push of pushes) {
    assert.match(push.args.join(" "), /ctr .*images push/);
    assert.doesNotMatch(push.args.join(" "), /push-password/);
  }
  assert.ok(
    inputs.every((input) =>
      Buffer.from(input.trim(), "base64")
        .toString()
        .includes("kore-push:push-password"),
    ),
    "the push password goes through stdin only",
  );

  const cosign = calls.filter(({ command }) => command === "cosign");
  assert.deepEqual(
    cosign.map(({ args }) => args[0]),
    ["generate-key-pair", "sign"],
  );
  const sign = cosign[1]!.args.join(" ");
  assert.match(sign, /kore-admission-probe\/foreign-signed@sha256:d+/);
  assert.doesNotMatch(sign, /kore-local-signing-key|k8s:\/\//);
  assert.doesNotMatch(
    sign,
    /unsigned@/,
    "the unsigned copy is never signed by anyone",
  );
  assert.ok(
    envs.every((env) => env["COSIGN_PASSWORD"] === "" || env["DOCKER_CONFIG"]),
  );
  for (const call of calls) {
    assert.ok(
      !call.args.some((arg) => arg.includes("push-password")),
      "no secret appears in an argument",
    );
  }
});

test("a signed copy is pushed under its own probe repository and signed with the cluster's local key, never a file key", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner = healthyRunner(calls);

  const signed = await publishSignedCopy(
    repository,
    runner,
    source,
    "swapped",
    {
      registry: { isPortOpen: async () => true },
      digest: async () => copiedDigest,
    },
  );

  assert.equal(
    signed,
    `10.96.0.50:5000/kore-admission-probe/swapped@${copiedDigest}`,
  );
  const sign = calls.find(
    ({ command, args }) => command === "cosign" && args[0] === "sign",
  )!;
  assert.match(
    sign.args.join(" "),
    /k8s:\/\/kore-system\/kore-local-signing-key/,
  );
  assert.match(sign.args.join(" "), /kore-admission-probe\/swapped@sha256:d+/);
  assert.equal(
    calls.filter(({ command }) => command === "cosign").length,
    1,
    "no throwaway key is generated",
  );
});

test("scaling names the environment context and namespace, never the current context", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await scaleDeployment(repository, runner, "kore-registry", "oci-registry", 0);

  assert.deepEqual(calls[0]!.args, [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "kore-registry",
    "scale",
    "deployment/oci-registry",
    "--replicas=0",
  ]);
  assert.equal(
    calls.length,
    1,
    "scaling is one mutation; waiting is the caller's",
  );
});

test("a probe can name the ServiceAccount its pod uses, so identity policy can be probed", async () => {
  const repository = await loadRepository("local");
  let body = "";
  const runner: Runner = {
    async run(_command, _args, options) {
      body = options?.input ?? "";
      return { stdout: "pod/x created (server dry run)", stderr: "", code: 0 };
    },
  };

  await admissionVerdict(repository, runner, "reference", source, {
    serviceAccountName: "default",
  });

  assert.equal(JSON.parse(body).spec.serviceAccountName, "default");
});

test("a probe without a ServiceAccount option leaves the pod spec unchanged", async () => {
  const repository = await loadRepository("local");
  let body = "";
  const runner: Runner = {
    async run(_command, _args, options) {
      body = options?.input ?? "";
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await admissionVerdict(repository, runner, "reference", source);

  assert.equal("serviceAccountName" in JSON.parse(body).spec, false);
});
