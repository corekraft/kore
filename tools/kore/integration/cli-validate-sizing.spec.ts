// kore validate over a copy of this repository with the app-sizing flag off and on (#1525). The
// flag is flipped only in the temporary copy, never in the tracked overlay. The Service XRD is
// read from the copied platform-apis chart, so the sizing fields are checked against it as they
// are in the repository. Real yq and git; no cluster is touched.
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
const services = "infra/environments/local/services";
const organizations = "infra/environments/local/organizations";
const environmentFile = "infra/environments/local/environment.yaml";

let root: string;
let previousRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kore-validate-sizing-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  previousRoot = process.env.KORE_ROOT;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await rm(join(root, "infra"), { recursive: true, force: true });
  await rm(join(root, "docs"), { recursive: true, force: true });
  await rm(join(root, "apps"), { recursive: true, force: true });
  await cp(new URL("apps/", repository), join(root, "apps"), {
    recursive: true,
  });
  await cp(new URL("infra/", repository), join(root, "infra"), {
    recursive: true,
  });
  // The exemption check reads the ADRs' status lines from docs/decisions.
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

/** Turns app-sizing on in the temporary copy of the local overlay only. */
async function flagOn(): Promise<void> {
  const path = join(root, environmentFile);
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    text.replace('"app-sizing": false', '"app-sizing": true'),
  );
}

const suborg = (cpu: string, memory: string) =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Organization",
    metadata: { name: "team-a" },
    spec: {
      tenant: "platform",
      parent: "platform",
      quota: {
        requests: { cpu, memory },
        pods: 10,
        storage: "10Gi",
      },
    },
  });

const leads = (component: Record<string, unknown>) =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name: "leads" },
    spec: {
      organization: "team-a",
      environments: ["local"],
      components: { frontend: component },
    },
  });

const fitting = {
  resources: {
    requests: { cpu: "500m", memory: "512Mi", ephemeralStorage: "1Gi" },
  },
  autoscaling: { minReplicas: 2, maxReplicas: 5 },
};

test("with app-sizing off, a record without its sizing fields validates, and so does one missing a memory request", async () => {
  await records({
    [`${services}/leads.json`]: leads({
      resources: { requests: { cpu: "500m" } },
    }),
    [`${organizations}/team-a.json`]: suborg("4", "4Gi"),
  });
  expect(await main(["validate"])).toBe(0);
});

test("with app-sizing on, a record that fits its suborg quota validates", async () => {
  await records({
    [`${services}/leads.json`]: leads(fitting),
    [`${organizations}/team-a.json`]: suborg("4", "4Gi"),
  });
  await flagOn();
  expect(await main(["validate"])).toBe(0);
});

test("with app-sizing on, a record with no memory request is refused, naming the field", async () => {
  await records({
    [`${services}/leads.json`]: leads({
      resources: { requests: { cpu: "500m", ephemeralStorage: "1Gi" } },
    }),
    [`${organizations}/team-a.json`]: suborg("4", "4Gi"),
  });
  await flagOn();
  await expect(main(["validate"])).rejects.toThrow(
    `${services}/leads.json.spec.components.frontend.resources.requests.memory: a memory request is required`,
  );
});

test("with app-sizing on, a memory limit unequal to the request is refused, naming both", async () => {
  await records({
    [`${services}/leads.json`]: leads({
      resources: {
        requests: { cpu: "500m", memory: "512Mi", ephemeralStorage: "1Gi" },
        limits: { memory: "1Gi" },
      },
    }),
    [`${organizations}/team-a.json`]: suborg("4", "4Gi"),
  });
  await flagOn();
  await expect(main(["validate"])).rejects.toThrow(
    "resources.limits.memory: 1Gi must equal the memory request 512Mi",
  );
});

test("with app-sizing on, a worst case over the suborg memory quota is refused, naming the amount and the file to raise", async () => {
  await records({
    [`${services}/leads.json`]: leads(fitting),
    [`${organizations}/team-a.json`]: suborg("4", "2Gi"),
  });
  await flagOn();
  await expect(main(["validate"])).rejects.toThrow(
    `memory 3Gi requested, quota 2Gi; lower maxReplicas or a request, or raise spec.quota in ${organizations}/team-a.json`,
  );
});

test("with app-sizing on, a maximum below the minimum is refused, naming both", async () => {
  await records({
    [`${services}/leads.json`]: leads({
      ...fitting,
      autoscaling: { minReplicas: 4, maxReplicas: 3 },
    }),
    [`${organizations}/team-a.json`]: suborg("4", "4Gi"),
  });
  await flagOn();
  await expect(main(["validate"])).rejects.toThrow(
    "autoscaling.maxReplicas: 3 is below minReplicas 4",
  );
});
