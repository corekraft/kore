// Docs: docs/decisions/0028-image-trust-authority.md
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  admissionVerdict,
  deployedImage,
  ephemeralContainerVerdict,
  modifiedDigestReference,
  runningPodWithImage,
  scaleDeployment,
  scope,
  tagOnlyReference,
  verdictOf,
} from "./admission-probe.js";

vi.mock("./admission-probe-copies.js");

type Run = Runner["run"];

const DIGEST = "d".repeat(64);
const IMAGE = `registry.example:5000/app@sha256:${DIGEST}`;
const repository = {
  environment: { name: "local", kubeContext: "k3d-kore-local" },
} as unknown as Repository;

/** A typed runner answering every call with `stdout`, or throwing `failure`. */
function fakeRunner(stdout = "", failure?: unknown) {
  const run = vi.fn<Run>(async () => {
    if (failure !== undefined) {
      throw failure;
    }
    return { stdout, stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

/** A kubectl failure whose stderr is the given text. */
function refusal(stderr: string): CommandError {
  return new CommandError("kubectl", [], { stdout: "", stderr, code: 1 });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1296);
});

afterEach(() => {
  vi.useRealTimers();
});

test("a namespace's scope names the environment's context and the namespace, in that order", () => {
  expect(scope(repository, "reference")).toEqual([
    "--context",
    "k3d-kore-local",
    "--namespace",
    "reference",
  ]);
});

test("a server that admits the request is an admitted verdict with the trimmed reply", async () => {
  const { runner, run } = fakeRunner("  pod/x created  \n");

  expect(await verdictOf(runner, ["create"])).toEqual({
    admitted: true,
    detail: "pod/x created",
  });
  expect(run).toHaveBeenCalledWith("kubectl", ["create"], { capture: true });
});

test("a request with input passes the input to kubectl alongside the capture", async () => {
  const { runner, run } = fakeRunner();

  await verdictOf(runner, ["create", "--filename=-"], "{}");

  expect(run).toHaveBeenCalledWith("kubectl", ["create", "--filename=-"], {
    capture: true,
    input: "{}",
  });
});

test.each([
  'admission webhook "validation.gatekeeper.sh" denied the request: no',
  'Internal error occurred: failed calling webhook "x": connection refused',
])(
  "a webhook refusal is a denial verdict carrying its text: %s",
  async (stderr) => {
    const { runner } = fakeRunner("", refusal(`${stderr}\n`));

    expect(await verdictOf(runner, ["create"])).toEqual({
      admitted: false,
      detail: stderr,
    });
  },
);

test("any failure that is not a webhook refusal is rethrown unchanged, so an unreachable cluster is never a denial", async () => {
  const unreachable = refusal("The connection to the server was refused");
  const runtime = new TypeError("runner exploded");

  await expect(
    verdictOf(fakeRunner("", unreachable).runner, ["create"]),
  ).rejects.toBe(unreachable);
  await expect(
    verdictOf(fakeRunner("", runtime).runner, ["create"]),
  ).rejects.toBe(runtime);
});

test("a default probe is a Pod of the image in a main container, dry-run on the server from stdin", async () => {
  const { runner, run } = fakeRunner();

  await admissionVerdict(repository, runner, "reference", IMAGE);

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "reference",
      "create",
      "--dry-run=server",
      "--filename=-",
    ],
    { capture: true, input: expect.any(String) },
  );
  expect(JSON.parse(String(run.mock.calls[0]?.[2]?.input))).toEqual({
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "kore-admission-probe-100" },
    spec: {
      restartPolicy: "Never",
      containers: [{ name: "probe", image: IMAGE }],
    },
  });
});

test("an init container probe puts the probed image only in initContainers, beside a trusted main container", async () => {
  const { runner, run } = fakeRunner();

  await admissionVerdict(repository, runner, "reference", IMAGE, {
    placement: "initContainer",
    trusted: "trusted:1",
  });

  const pod = JSON.parse(String(run.mock.calls[0]?.[2]?.input)) as {
    spec: { containers: unknown; initContainers: unknown };
  };
  expect(pod.spec.containers).toEqual([{ name: "probe", image: "trusted:1" }]);
  expect(pod.spec.initContainers).toEqual([
    { name: "init-probe", image: IMAGE },
  ]);
});

test("an init container probe without a trusted main image is refused before any request is sent", async () => {
  const { runner, run } = fakeRunner();

  await expect(
    admissionVerdict(repository, runner, "reference", IMAGE, {
      placement: "initContainer",
    }),
  ).rejects.toThrow(
    "an init container probe needs a `trusted` main container image",
  );

  expect(run).not.toHaveBeenCalled();
});

test("a probe that names a ServiceAccount puts it on the pod, and one that names none puts nothing", async () => {
  const { runner, run } = fakeRunner();

  await admissionVerdict(repository, runner, "reference", IMAGE, {
    serviceAccountName: "reference-denied",
  });
  await admissionVerdict(repository, runner, "reference", IMAGE);

  const named = JSON.parse(String(run.mock.calls[0]?.[2]?.input)) as {
    spec: object;
  };
  const unnamed = JSON.parse(String(run.mock.calls[1]?.[2]?.input)) as {
    spec: object;
  };
  expect(named.spec).toMatchObject({ serviceAccountName: "reference-denied" });
  expect(unnamed.spec).not.toHaveProperty("serviceAccountName");
});

test("the running pod is the first Running pod whose first container runs the image", async () => {
  const { runner, run } = fakeRunner(
    JSON.stringify({
      items: [
        {
          metadata: { name: "other" },
          spec: { containers: [{ image: "other:1" }] },
        },
        {
          metadata: { name: "app-1" },
          spec: { containers: [{ image: IMAGE }] },
        },
      ],
    }),
  );

  expect(
    await runningPodWithImage(repository, runner, "reference", IMAGE),
  ).toBe("app-1");
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "reference",
      "get",
      "pods",
      "--field-selector=status.phase=Running",
      "--output=json",
    ],
    { capture: true },
  );
});

test("a pod already being deleted is skipped, because admission does not validate it", async () => {
  const { runner } = fakeRunner(
    JSON.stringify({
      items: [
        {
          metadata: {
            name: "dying",
            deletionTimestamp: "2026-11-14T00:00:00Z",
          },
          spec: { containers: [{ image: IMAGE }] },
        },
        {
          metadata: { name: "app-2" },
          spec: { containers: [{ image: IMAGE }] },
        },
      ],
    }),
  );

  expect(
    await runningPodWithImage(repository, runner, "reference", IMAGE),
  ).toBe("app-2");
});

test("no running pod of the image fails with the command that brings one up", async () => {
  const { runner } = fakeRunner(JSON.stringify({ items: [] }));

  await expect(
    runningPodWithImage(repository, runner, "reference", IMAGE),
  ).rejects.toThrow(
    `no Running pod of ${IMAGE} in namespace reference; run \`kore app up reference --environment local\` first so a signed workload is running`,
  );
});

test("an ephemeral container probe is a server dry-run patch of the ephemeralcontainers subresource", async () => {
  const { runner, run } = fakeRunner();

  await ephemeralContainerVerdict(
    repository,
    runner,
    "reference",
    "app-1",
    IMAGE,
  );

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "reference",
      "patch",
      "pod/app-1",
      "--subresource=ephemeralcontainers",
      "--dry-run=server",
      "--patch",
      JSON.stringify({
        spec: { ephemeralContainers: [{ name: "probe", image: IMAGE }] },
      }),
    ],
    { capture: true },
  );
});

test("the deployed image is the first Deployment's first container image, trimmed", async () => {
  const { runner } = fakeRunner(`${IMAGE}\n`);

  expect(await deployedImage(repository, runner, "reference")).toBe(IMAGE);
});

test("a namespace with no workload Deployment fails with the command that deploys one", async () => {
  const { runner } = fakeRunner("");

  await expect(deployedImage(repository, runner, "reference")).rejects.toThrow(
    "no workload Deployment in namespace reference; run `kore app up reference --environment local` first",
  );
});

test("the tag-only reference names the repository by kore-local unless another tag is given, and never by digest", () => {
  expect(tagOnlyReference(IMAGE)).toBe("registry.example:5000/app:kore-local");
  expect(tagOnlyReference(IMAGE, "canary")).toBe(
    "registry.example:5000/app:canary",
  );
});

test("an image with no sha256 digest is refused, naming the digest it needs", () => {
  expect(() => tagOnlyReference("registry.example/app:1")).toThrow(
    "registry.example/app:1 carries no sha256 digest; pass the digest-qualified image the workload runs",
  );
});

test("the modified-digest reference changes the last digest character, keeping the repository and the rest of the digest", () => {
  expect(modifiedDigestReference(IMAGE)).toBe(
    `registry.example:5000/app@sha256:${"d".repeat(63)}0`,
  );
});

test("a modified digest that ends in 0 becomes 1, so it always differs from the signed digest", () => {
  const digest = `${"a".repeat(63)}0`;
  const result = modifiedDigestReference(`app@sha256:${digest}`);

  expect(result).toBe(`app@sha256:${"a".repeat(63)}1`);
  expect(result).not.toContain(digest);
});

test("scaling a Deployment runs kubectl scale with the replica count in the namespace's scope, capturing its output", async () => {
  const { runner, run } = fakeRunner();

  await scaleDeployment(repository, runner, "reference", "app", 0);

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "reference",
      "scale",
      "deployment/app",
      "--replicas=0",
    ],
    { capture: true },
  );
});
