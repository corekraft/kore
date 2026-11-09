import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Call } from "../app/app-fixtures.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  admissionVerdict,
  ephemeralContainerVerdict,
  runningPodWithImage,
} from "./admission-probe.js";

// Docs: docs/decisions/0032-application-namespace-image-admission.md
// Helpers for the opt-in live coverage specs (init and ephemeral containers).

const source = `10.96.0.50:5000/reference@sha256:${"c".repeat(64)}`;

function denied(stderr: string): CommandError {
  return new CommandError("kubectl", [], { stdout: "", stderr, code: 1 });
}

test("an init container probe puts the probed image only in initContainers, beside a trusted main container", async () => {
  const repository = await loadRepository("local");
  const inputs: string[] = [];
  const runner: Runner = {
    async run(_command, _args, options) {
      inputs.push(options?.input ?? "");
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  const unsigned = "10.96.0.50:5000/kore-admission-probe/unsigned@sha256:x";

  await admissionVerdict(repository, runner, "reference", unsigned, {
    placement: "initContainer",
    trusted: source,
  });

  const spec = (JSON.parse(inputs[0]!) as { spec: Record<string, unknown> })
    .spec as {
    containers: { image: string }[];
    initContainers: { image: string }[];
  };
  assert.deepEqual(
    spec.initContainers.map(({ image }) => image),
    [unsigned],
  );
  assert.deepEqual(
    spec.containers.map(({ image }) => image),
    [source],
    "the main container is the trusted image so only the init container can cause a denial",
  );
});

test("an init container probe without a trusted main image is refused before any request", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run() {
      throw new Error("must not run");
    },
  };

  await assert.rejects(
    admissionVerdict(repository, runner, "reference", source, {
      placement: "initContainer",
    }),
    /trusted/,
  );
});

test("the running pod is found by the image it runs, in the named namespace and context", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return { stdout: "reference-abc\n", stderr: "", code: 0 };
    },
  };

  assert.equal(
    await runningPodWithImage(repository, runner, "reference", source),
    "reference-abc",
  );
  const args = calls[0]!.args;
  assert.deepEqual(args.slice(0, 4), [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "reference",
  ]);
  assert.ok(args.includes("--field-selector=status.phase=Running"));
  assert.ok(args.some((arg) => arg.includes(source)));
});

test("no running pod of the image fails with the fix instead of probing nothing", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run() {
      return { stdout: "  \n", stderr: "", code: 0 };
    },
  };

  await assert.rejects(
    runningPodWithImage(repository, runner, "reference", source),
    /kore app up reference/,
  );
});

test("an ephemeral container probe is a server dry-run patch of the ephemeralcontainers subresource that changes nothing", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return { stdout: "pod/x patched (server dry run)", stderr: "", code: 0 };
    },
  };

  const verdict = await ephemeralContainerVerdict(
    repository,
    runner,
    "reference",
    "reference-abc",
    source,
  );

  assert.equal(verdict.admitted, true);
  const args = calls[0]!.args;
  assert.ok(args.includes("--dry-run=server"), "never a real mutation");
  assert.ok(args.includes("--subresource=ephemeralcontainers"));
  assert.deepEqual(args.slice(0, 4), [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "reference",
  ]);
  assert.ok(args.includes("pod/reference-abc"));
  const patch = args[args.indexOf("--patch") + 1]!;
  assert.deepEqual(JSON.parse(patch), {
    spec: { ephemeralContainers: [{ name: "probe", image: source }] },
  });
});

test("a webhook denial of an ephemeral container is a verdict, any other failure is rethrown", async () => {
  const repository = await loadRepository("local");
  const failing = (stderr: string): Runner => ({
    async run() {
      throw denied(stderr);
    },
  });

  const verdict = await ephemeralContainerVerdict(
    repository,
    failing(
      'admission webhook "policy.sigstore.dev" denied the request: no signatures found',
    ),
    "reference",
    "reference-abc",
    source,
  );
  assert.equal(verdict.admitted, false);
  assert.match(verdict.detail, /no signatures found/);

  await assert.rejects(
    ephemeralContainerVerdict(
      repository,
      failing('pods "reference-abc" not found'),
      "reference",
      "reference-abc",
      source,
    ),
    /not found/,
  );
});
