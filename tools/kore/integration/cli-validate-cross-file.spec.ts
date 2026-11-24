// kore validate over a copy of this repository, with suborg and service records written into the
// environment's directories, and the cross-file rules checked end to end: the suborg a service
// names, the grants, the requests against the suborg quota, and the suborg quotas against the
// environment's capacity. The platform chart, the catalog and the overlays are copied, so the
// Service schema is the one that ships. Real yq and git; no cluster is touched.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { main } from "../src/testing/index.js";

const repository = new URL("../../../", import.meta.url);
const local = "infra/environments/local";

let root: string;
let previousRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kore-validate-cross-file-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  previousRoot = process.env.KORE_ROOT;
  written.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await rm(join(root, "infra"), { recursive: true, force: true });
  await rm(join(root, "apps"), { recursive: true, force: true });
  await cp(new URL("infra/", repository), join(root, "infra"), {
    recursive: true,
  });
  await cp(new URL("apps/", repository), join(root, "apps"), {
    recursive: true,
  });
  await rm(join(root, "docs"), { recursive: true, force: true });
  await cp(
    new URL("docs/decisions/", repository),
    join(root, "docs/decisions"),
    { recursive: true },
  );
  process.env.KORE_ROOT = root;
});

afterEach(() => {
  if (previousRoot === undefined) {
    delete process.env.KORE_ROOT;
  } else {
    process.env.KORE_ROOT = previousRoot;
  }
  vi.restoreAllMocks();
});

async function records(files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** A suborg record with a quota, one level below platform. */
const suborg = (name: string, cpu = "2", memory = "4Gi") =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Organization",
    metadata: { name },
    spec: {
      tenant: "platform",
      parent: "platform",
      quota: { requests: { cpu, memory }, pods: 50, storage: "100Gi" },
    },
  });

/** A Service spec file in a suborg, with a frontend, its requests and its grants. */
const service = (
  name: string,
  organization: string,
  {
    cpu = "1",
    memory = "512Mi",
    allowFrom = [] as string[],
  }: { cpu?: string; memory?: string; allowFrom?: string[] } = {},
) =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name },
    spec: {
      organization,
      environments: ["local"],
      components: {
        frontend: { resources: { requests: { cpu, memory } } },
      },
      allowFrom,
    },
  });

/** What the command printed to stdout since the test began. */
const written: string[] = [];

function output(): string {
  return written.join("");
}

const suborgs = `${local}/organizations`;
const services = `${local}/services`;

test("kore validate passes a service in a suborg whose grant, requests and quota all fit", async () => {
  await records({
    [`${suborgs}/team-a.json`]: suborg("team-a"),
    [`${services}/checkout.json`]: service("checkout", "team-a", {
      allowFrom: ["team-a/api"],
    }),
    [`${services}/api.json`]: service("api", "team-a"),
  });
  expect(await main(["validate"])).toBe(0);
});

test("kore validate reports that the suborg quotas are not judged when the environment declares no capacity", async () => {
  await records({ [`${suborgs}/team-a.json`]: suborg("team-a") });
  expect(await main(["validate", "--json"])).toBe(0);
  const report = JSON.parse(output()) as { warnings: string[] };
  expect(report.warnings).toContain(
    `${suborgs}: the suborg quotas are not checked against the capacity of environment local: environment.cluster is not declared (ADR 0152), so the sum is not judged`,
  );
});

test("kore validate refuses a service that names a suborg the environment does not declare", async () => {
  await records({
    [`${services}/checkout.json`]: service("checkout", "team-z"),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${services}/checkout.json.spec.organization: "team-z" is not a suborg of environment local: create ${suborgs}/team-z.json, or name an existing suborg (platform is the tenant root)`,
  );
});

test("kore validate refuses a removed suborg that a service still names, naming the service", async () => {
  await records({
    [`${suborgs}/team-a.json`]: suborg("team-a"),
    [`${services}/checkout.json`]: service("checkout", "team-a"),
  });
  await rm(join(root, suborgs, "team-a.json"));
  await expect(main(["validate"])).rejects.toThrow(
    `${services}/checkout.json.spec.organization: "team-a" is not a suborg of environment local`,
  );
});

test("kore validate passes a suborg and its services removed together", async () => {
  await records({
    [`${suborgs}/team-a.json`]: suborg("team-a"),
    [`${services}/checkout.json`]: service("checkout", "team-a"),
  });
  await rm(join(root, suborgs, "team-a.json"));
  await rm(join(root, services, "checkout.json"));
  expect(await main(["validate"])).toBe(0);
});

test("kore validate refuses a grant to a service that was removed, naming the entry", async () => {
  await records({
    [`${suborgs}/team-a.json`]: suborg("team-a"),
    [`${services}/checkout.json`]: service("checkout", "team-a", {
      allowFrom: ["team-a/gone"],
    }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${services}/checkout.json.spec.allowFrom: "team-a/gone" is not a service of environment local in suborg team-a`,
  );
});

test("kore validate refuses a grant written without its suborg, naming the form it must take", async () => {
  await records({
    [`${suborgs}/team-a.json`]: suborg("team-a"),
    [`${services}/checkout.json`]: service("checkout", "team-a", {
      allowFrom: ["api"],
    }),
    [`${services}/api.json`]: service("api", "team-a"),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${services}/checkout.json.spec.allowFrom: "api" does not name its grantee's suborg: write it as <suborg>/<service>, for example "team-a/api"`,
  );
});

test("kore validate refuses a service that grants itself", async () => {
  await records({
    [`${suborgs}/team-a.json`]: suborg("team-a"),
    [`${services}/checkout.json`]: service("checkout", "team-a", {
      allowFrom: ["team-a/checkout"],
    }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${services}/checkout.json.spec.allowFrom: "team-a/checkout" is this service: a service may not grant itself access; remove the entry`,
  );
});

test("kore validate refuses requests over the suborg quota, naming the dimension, the quota and the file to raise", async () => {
  await records({
    [`${suborgs}/team-a.json`]: suborg("team-a", "1", "4Gi"),
    [`${services}/checkout.json`]: service("checkout", "team-a", {
      cpu: "1500m",
    }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${services}/checkout.json.spec.components: the requests of checkout exceed the quota of suborg team-a: cpu 1500m requested, quota 1; lower the components' resources.requests or raise spec.quota in ${suborgs}/team-a.json`,
  );
});

test("kore validate sums the suborg quotas against the environment's capacity, and refuses a sum over the committed share", async () => {
  const vps = "infra/environments/vps";
  const path = join(root, vps, "environment.yaml");
  const environment = JSON.parse(await readFile(path, "utf8")) as {
    cluster: Record<string, unknown>;
  };
  environment.cluster.kubelet = {
    kubeReserved: { cpu: "500m", memory: "1Gi" },
    systemReserved: { cpu: "500m", memory: "1Gi" },
    evictionHard: { memory: "512Mi" },
  };
  environment.cluster.diskReserve = "20g";
  await writeFile(path, JSON.stringify(environment, null, 2));
  await records({
    [`${vps}/organizations/team-a.json`]: suborg("team-a", "2", "4Gi"),
    [`${vps}/organizations/team-b.json`]: suborg("team-b", "1500m", "4Gi"),
  });
  await expect(main(["validate", "--environment", "vps"])).rejects.toThrow(
    `${vps}/organizations: the suborg quotas together exceed what environment vps can commit: cpu 3500m against 2400m`,
  );
});
