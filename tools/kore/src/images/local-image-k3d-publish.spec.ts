import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import {
  digest,
  encodeBase64,
  entry,
  fakeRunner,
  pushPassword,
  stubRegistry,
} from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";
import { publishImageCopy } from "./local-publish.js";
import {
  k3dImagePublishArgs,
  k3dRegistrySessionArgs,
} from "./local-image-args.js";

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ localRegistryReference: registryReference }));
const registryHead = vi.hoisted(() => vi.fn());
vi.mock("./registry-https.js", () => ({ registryHead }));

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function k3dRepository(): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-k3d-publish-"));
  roots.push(root);
  const base = await loadRepository("local");
  const { cluster: _cluster, ...environment } = base.environment;
  return {
    ...base,
    root,
    environment: {
      ...environment,
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      k3d: {
        clusterName: "kore-local",
        serviceCidr: "10.96.0.0/12",
        ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
      },
    },
  };
}

const basic = encodeBase64(`kore-push:${pushPassword}`);

test("k3d publishes through the node's containerd client with docker exec, and no node shell", async () => {
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(
    await k3dRepository(),
    runner,
    "reference",
    entry,
  );

  const commands = calls.map(({ command }) => command);
  expect(commands).not.toContain("ssh");
  const publish = calls.find(
    (c) => c.command === "docker" && c.args[0] === "exec",
  )!;
  expect(publish.args.slice(0, 3)).toEqual([
    "exec",
    "--interactive",
    "k3d-kore-local-server-0",
  ]);
  expect(publish.args.join(" ")).toContain("ctr");
  expect(publish.args.join(" ")).toContain("push");
});

test("the built image is named by the registry address the nodes and the image policy use, not the release lock's host", async () => {
  const { runner } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  const built = await buildAndSignLocalImage(
    await k3dRepository(),
    runner,
    "reference",
    entry,
  );

  expect(entry.image).toBe("registry.kore.local:30500/reference");
  expect(built.image.reference).toBe(`10.96.0.50:5000/reference@${digest}`);
});

test("the k3d push credential travels only on stdin, never in an argument", async () => {
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(
    await k3dRepository(),
    runner,
    "reference",
    entry,
  );

  const publish = calls.find(
    (c) => c.command === "docker" && c.args[0] === "exec",
  )!;
  expect(publish.options?.input).toBe(`${basic}\n`);
  const everyArgument = JSON.stringify(calls.map((c) => c.args));
  expect(everyArgument).not.toContain(pushPassword);
  expect(everyArgument).not.toContain(basic);
});

test("the k3d node keeps the credential in memory-backed storage and removes it on every exit", () => {
  const args = k3dImagePublishArgs(
    "kore-local",
    "kore-local/reference:kore-local",
    "10.96.0.50:5000",
    "reference:kore-local",
    "CA",
  );
  const script = args.join(" ");
  expect(script).toContain("/dev/shm");
  expect(script).toMatch(/trap .*rm -rf/);
  expect(script).toContain("IFS= read -r");
  expect(script).toContain("--hosts-dir");
});

test("the k3d node also names the pushed image by its digest, so a digest reference resolves with pull policy Never", () => {
  const script = k3dImagePublishArgs(
    "kore-local",
    "kore-local/reference:kore-local",
    "10.96.0.50:5000",
    "reference:kore-local",
    "CA",
  ).join(" ");
  const tags = script.match(/images tag --force/g) ?? [];
  expect(tags).toHaveLength(2);
  expect(script).toMatch(
    /images ls "name==10\.96\.0\.50:5000\/reference:kore-local"/,
  );
  expect(script).toContain("10.96.0.50:5000/reference@");
  expect(script.indexOf("images push")).toBeLessThan(
    script.lastIndexOf("images tag --force"),
  );
});

test("a failed k3d publish never carries the credential in its error", async () => {
  const { runner } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const echoing: typeof runner = {
    async run(command, args, options) {
      if (command === "docker" && args[0] === "exec") {
        throw new Error(`docker exec failed (1): ${pushPassword} ${basic}`);
      }
      return runner.run(command, args, options);
    },
  };

  const error = await buildAndSignLocalImage(
    await k3dRepository(),
    echoing,
    "reference",
    entry,
  ).catch((e: unknown) => e as Error);

  if (!(error instanceof Error)) {
    throw new Error("the failed publish must reject");
  }
  expect(error.message).not.toContain(pushPassword);
  expect(error.message).not.toContain(basic);
  expect(String(error.stack)).not.toContain(pushPassword);
  expect(error.message).toContain("[REDACTED]");
});

test("the k3d session rejects a malformed address before running anything", () => {
  expect(() =>
    k3dRegistrySessionArgs("kore-local", "bad address;", "CA", ["true"]),
  ).toThrow(/invalid registry address/);
});

test("the k3d publish command is pinned line by line", () => {
  const args = k3dImagePublishArgs(
    "kore-local",
    "kore-local/reference:kore-local",
    "10.96.0.50:5000",
    "reference:kore-local",
    "CA",
  );
  const hostsHead = [
    'server = "https://10.96.0.50:5000"',
    "",
    '[host."https://10.96.0.50:5000"]',
    '  capabilities = ["pull", "resolve", "push"]',
    '  ca = "ca.crt"',
    "",
    '  [host."https://10.96.0.50:5000".header]',
    '    Authorization = "Basic ',
  ].join("\n");
  expect(args.slice(0, 5)).toEqual([
    "exec",
    "--interactive",
    "k3d-kore-local-server-0",
    "sh",
    "-c",
  ]);
  expect(args).toHaveLength(6);
  expect(args[5]!.split("\n")).toEqual([
    "set -e",
    '[ -w /dev/shm ] || { echo "the k3d node has no writable /dev/shm for the registry credential" >&2; exit 1; }',
    "d=$(mktemp -d -p /dev/shm)",
    `trap 'rm -rf "$d"' EXIT INT TERM HUP`,
    `mkdir -p "$d"/'10.96.0.50:5000'`,
    `printf '%s' 'Q0E=' | base64 -d > "$d"/'10.96.0.50:5000/ca.crt'`,
    `IFS= read -r t && [ -n "$t" ] || { echo "no registry credential was supplied on stdin" >&2; exit 1; }`,
    ...`printf '%s%s"\\n' '${hostsHead}' "$t" > "$d"/'10.96.0.50:5000/hosts.toml'`.split(
      "\n",
    ),
    "unset t",
    `ctr --namespace k8s.io images tag --force 'docker.io/kore-local/reference:kore-local' '10.96.0.50:5000/reference:kore-local'`,
    `ctr --namespace k8s.io images push --hosts-dir "$d" '10.96.0.50:5000/reference:kore-local'`,
    `g=$(ctr --namespace k8s.io images ls "name==10.96.0.50:5000/reference:kore-local" | awk 'NR==2{print $3}')`,
    `test -n "$g"`,
    `ctr --namespace k8s.io images tag --force '10.96.0.50:5000/reference:kore-local' "10.96.0.50:5000/reference@$g"`,
  ]);
});

test("the k3d node removes the credential on interrupt and termination too", () => {
  const script = k3dImagePublishArgs(
    "kore-local",
    "kore-local/reference:kore-local",
    "10.96.0.50:5000",
    "reference:kore-local",
    "CA",
  )[5]!;
  expect(script).toContain(`trap 'rm -rf "$d"' EXIT INT TERM HUP`);
});

test("a host-qualified source is tagged as it is, without a docker.io prefix", () => {
  const script = k3dImagePublishArgs(
    "kore-local",
    "10.96.0.50:5000/reference@sha256:abc",
    "10.96.0.50:5000",
    "probe:kore-local",
    "CA",
  )[5]!;
  expect(script).toContain(
    "images tag --force '10.96.0.50:5000/reference@sha256:abc'",
  );
});

test("a k3d username that would not be a valid registry user is rejected before the header is built", async () => {
  const repository = await k3dRepository();
  const { runner, calls } = fakeRunner();
  await expect(
    publishImageCopy(
      repository,
      runner,
      {
        tag: "t:kore-local",
        address: "10.96.0.50:5000",
        target: "x:kore-local",
      },
      {
        credential: { username: "Bad User", password: pushPassword },
        ca: "CA",
      },
    ),
  ).rejects.toThrow(/invalid username/);
  expect(calls).toHaveLength(0);
});
