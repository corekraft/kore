// Docs: docs/decisions/0056-platform-image-inventory.md
import { beforeEach, expect, test, vi } from "vitest";
import { approvedImageList } from "../config/index.js";
import { managedNamespaces } from "./gated-release.js";
import {
  classifyImage,
  imageInventory,
  imageInventoryStatus,
} from "./image-inventory.js";
import {
  approvedEntryOf,
  repositoryOf,
  runnerFake,
} from "./gate-unit-support.js";

vi.mock("../config/index.js");
vi.mock("./gated-release.js");

const mirror = "mirror.kore.local/platform";
const registry = "registry.kore.local:5001";
const digest = `sha256:${"a".repeat(64)}`;
const repository = repositoryOf({
  platformMirror: mirror,
  registry: { address: registry },
});

/** A pod with containers of each kind, as `kubectl get pods -o json` lists it. */
function pod(
  namespace: string,
  name: string,
  images: { containers?: string[]; init?: string[]; ephemeral?: string[] },
  phase = "Running",
) {
  const named = (list: string[] = []) =>
    list.map((image, i) => ({ name: `c${i}`, image }));
  return {
    metadata: { namespace, name },
    status: { phase },
    spec: {
      containers: named(images.containers),
      initContainers: named(images.init),
      ephemeralContainers: named(images.ephemeral),
    },
  };
}

function listing(items: unknown[]): string {
  return JSON.stringify({ items });
}

beforeEach(() => {
  vi.mocked(approvedImageList).mockReturnValue([]);
  vi.mocked(managedNamespaces).mockResolvedValue(["app"]);
});

test("a tag-only image is classified tag-only, whatever its registry", () => {
  expect(classifyImage(repository, "nginx:1.25")).toBe("tag-only");
});

test("an approved digest under the platform mirror is internal-digest", () => {
  const image = `${mirror}/api@${digest}`;
  vi.mocked(approvedImageList).mockReturnValue([approvedEntryOf(image)]);

  expect(classifyImage(repository, image)).toBe("internal-digest");
});

test("an approved digest under the registry address is internal-digest too", () => {
  const image = `${registry}/api@${digest}`;
  vi.mocked(approvedImageList).mockReturnValue([approvedEntryOf(image)]);

  expect(classifyImage(repository, image)).toBe("internal-digest");
});

test("a digest under the mirror that the approved list does not hold is unknown, never internal", () => {
  expect(classifyImage(repository, `${mirror}/api@${digest}`)).toBe("unknown");
});

test("an approved seed digest from upstream is classified seed", () => {
  const image = `docker.io/library/seed@${digest}`;
  vi.mocked(approvedImageList).mockReturnValue([approvedEntryOf(image, true)]);

  expect(classifyImage(repository, image)).toBe("seed");
});

test("an approved upstream digest that is not a seed is approved-upstream-digest", () => {
  const image = `docker.io/library/tool@${digest}`;
  vi.mocked(approvedImageList).mockReturnValue([approvedEntryOf(image)]);

  expect(classifyImage(repository, image)).toBe("approved-upstream-digest");
});

test("an upstream digest the approved list does not hold is unknown", () => {
  expect(classifyImage(repository, `docker.io/x/y@${digest}`)).toBe("unknown");
});

test("the inventory covers containers, init and ephemeral containers of managed pods, skipping finished ones and other namespaces", async () => {
  const { runner } = runnerFake((_command, args) => {
    if (args.includes("pods")) {
      return {
        stdout: listing([
          pod("app", "web", {
            containers: ["nginx:1.25"],
            init: [`${mirror}/init@${digest}`],
            ephemeral: ["busybox"],
          }),
          pod("app", "done", { containers: ["nginx:1.25"] }, "Succeeded"),
          pod("other", "stray", { containers: ["nginx:1.25"] }),
        ]),
        stderr: "",
        code: 0,
      };
    }
    return { stdout: listing([]), stderr: "", code: 0 };
  });
  vi.mocked(approvedImageList).mockReturnValue([
    approvedEntryOf(`${mirror}/init@${digest}`),
  ]);

  const inventory = await imageInventory(repository, runner);

  expect(
    inventory.images.map((found) => [
      found.pod,
      found.kind,
      found.classification,
    ]),
  ).toEqual([
    ["web", "container", "tag-only"],
    ["web", "init", "internal-digest"],
    ["web", "ephemeral", "tag-only"],
  ]);
});

test("a managed namespace without the enrollment label is unenrolled, unless it is exempt", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue(["app", "exempt", "labelled"]);
  const { runner } = runnerFake((_command, args) => ({
    stdout: args.includes("namespaces")
      ? listing([
          {
            metadata: {
              name: "labelled",
              labels: { "policy.sigstore.dev/include": "true" },
            },
          },
        ])
      : listing([]),
    stderr: "",
    code: 0,
  }));
  const exempting = repositoryOf({
    enrollmentExemptions: { exempt: "legacy workload" },
  });

  const inventory = await imageInventory(exempting, runner);

  expect(inventory.unenrolledNamespaces).toEqual(["app"]);
});

test("the inventory mode comes from the environment and defaults to audit", async () => {
  const { runner } = runnerFake(() => ({
    stdout: listing([]),
    stderr: "",
    code: 0,
  }));

  const defaulted = await imageInventory(repository, runner);
  const enforced = await imageInventory(
    repositoryOf({ imageInventory: "enforce" }),
    runner,
  );

  expect(defaulted.mode).toBe("audit");
  expect(enforced.mode).toBe("enforce");
});

test("the inventory only reads: every kubectl call is a get", async () => {
  const { run, runner } = runnerFake(() => ({
    stdout: listing([]),
    stderr: "",
    code: 0,
  }));

  await imageInventory(repository, runner);

  expect(run).toHaveBeenCalled();
  for (const [command, args] of run.mock.calls) {
    expect(command).toBe("kubectl");
    expect(args).toContain("get");
  }
});

test("an unreadable cluster is degraded, names the read error, and is never ready", async () => {
  const { runner } = runnerFake(() => {
    throw new Error("connection refused");
  });

  const status = await imageInventoryStatus(repository, runner);

  expect(status).toMatchObject({
    name: "image-inventory",
    namespace: "cluster",
    status: "degraded",
    detail: "image inventory could not be read: connection refused",
  });
});

test("audit findings are reported, but the status stays ready", async () => {
  const { runner } = runnerFake((_command, args) => ({
    stdout: args.includes("pods")
      ? listing([pod("app", "web", { containers: ["nginx:1.25"] })])
      : listing([]),
    stderr: "",
    code: 0,
  }));

  const status = await imageInventoryStatus(repository, runner);

  expect(status.status).toBe("ready");
  expect(status.detail).toBe("audit: 1 tag-only, 1 namespace(s) not enrolled");
});

test("enforce findings are degraded and name each offending pod, container and image", async () => {
  const { runner } = runnerFake((_command, args) => ({
    stdout: args.includes("pods")
      ? listing([pod("app", "web", { containers: ["nginx:1.25"] })])
      : listing([]),
    stderr: "",
    code: 0,
  }));
  const enforcing = repositoryOf({ imageInventory: "enforce" });

  const status = await imageInventoryStatus(enforcing, runner);

  expect(status.status).toBe("degraded");
  expect(status.detail).toBe(
    "enforce: app/web container c0 nginx:1.25 (tag-only); namespace app lacks policy.sigstore.dev/include=true",
  );
});

test("enforce with only internal digests and enrolled namespaces is ready", async () => {
  const image = `${mirror}/api@${digest}`;
  vi.mocked(approvedImageList).mockReturnValue([approvedEntryOf(image)]);
  const { runner } = runnerFake((_command, args) => ({
    stdout: args.includes("pods")
      ? listing([pod("app", "api", { containers: [image] })])
      : listing([
          {
            metadata: {
              name: "app",
              labels: { "policy.sigstore.dev/include": "true" },
            },
          },
        ]),
    stderr: "",
    code: 0,
  }));
  const enforcing = repositoryOf({
    imageInventory: "enforce",
    platformMirror: mirror,
    registry: { address: registry },
  });

  const status = await imageInventoryStatus(enforcing, runner);

  expect(status.status).toBe("ready");
  expect(status.detail).toBe("enforce: every image is an internal digest");
});
