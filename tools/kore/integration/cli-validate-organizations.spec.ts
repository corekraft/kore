// kore validate over a copy of this repository, driven through the command, with suborg
// Organization records written into the environment's organizations directory. The
// platform chart, the catalog and the overlays are copied, so the reserved names come
// from the real catalog. Real yq and git; no cluster is touched.
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
const dir = "infra/environments/local/organizations";

let root: string;
let previousRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kore-validate-organizations-"));
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

const suborg = (name: string, spec: Record<string, unknown> = {}) =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Organization",
    metadata: { name },
    spec: {
      tenant: "platform",
      parent: "platform",
      quota: {
        requests: { cpu: "8", memory: "16Gi" },
        pods: 50,
        storage: "100Gi",
      },
      ...spec,
    },
  });

/** What the command printed to stdout since the test began. */
const written: string[] = [];

function output(): string {
  return written.join("");
}

test("kore validate passes a well-formed suborg and reports its default zone", async () => {
  await records({ [`${dir}/api.json`]: suborg("api") });
  expect(await main(["validate", "--json"])).toBe(0);
  const report = JSON.parse(output()) as {
    organizations: { name: string; zone: string }[];
  };
  expect(report.organizations).toEqual([
    { name: "api", zone: "api.kore.internal" },
  ]);
});

test("kore validate adds no organizations key when the environment has no suborg", async () => {
  expect(await main(["validate", "--json"])).toBe(0);
  expect(JSON.parse(output())).not.toHaveProperty("organizations");
});

test("kore validate refuses a suborg with no quota, naming spec.quota and that it has no default", async () => {
  await records({
    [`${dir}/api.json`]: JSON.stringify({
      apiVersion: "platform.kore.dev/v1alpha1",
      kind: "Organization",
      metadata: { name: "api" },
      spec: { tenant: "platform", parent: "platform" },
    }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/api.json.spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage`,
  );
});

test("kore validate refuses a reserved suborg name, naming the reason", async () => {
  await records({ [`${dir}/argocd.json`]: suborg("argocd") });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/argocd.json.metadata.name: "argocd" is a reserved name: it is a platform namespace, an Argo CD project the platform owns, default, internal, www or reference; choose another name, for example "argocd-team"`,
  );
});

test("kore validate refuses the OpenBao platform namespace as a suborg name, even with the openbao flag off", async () => {
  await records({ [`${dir}/openbao.json`]: suborg("openbao") });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/openbao.json.metadata.name: "openbao" is a reserved name: it is a platform namespace, an Argo CD project the platform owns, default, internal, www or reference; choose another name, for example "openbao-team"`,
  );
});

test("kore validate refuses a suborg name with a double hyphen", async () => {
  await records({ [`${dir}/pay--team.json`]: suborg("pay--team") });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/pay--team.json.metadata.name: must not contain a double hyphen: the suborg namespace is <suborg> and its preview is <suborg>--preview; rename it, for example "pay-team"`,
  );
});

test("kore validate refuses a 55-character suborg name, naming the 54-character limit", async () => {
  const name = "a".repeat(55);
  await records({ [`${dir}/${name}.json`]: suborg(name) });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/${name}.json.metadata.name: must be at most 54 characters, so <suborg>--preview fits 63; shorten it, for example "${"a".repeat(54)}"`,
  );
});

test("kore validate refuses a parent that is not the tenant root", async () => {
  await records({
    [`${dir}/api.json`]: suborg("api", { parent: "payments" }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/api.json.spec.parent: must be "platform", the tenant root: v1 places a suborg one level below it; set it to "platform"`,
  );
});

test("kore validate refuses a suborg whose parent is another suborg, which is depth two", async () => {
  await records({
    [`${dir}/api.json`]: suborg("api"),
    [`${dir}/leads.json`]: suborg("leads", { parent: "api" }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/leads.json.spec.parent: "api" is a suborg, so this suborg would sit at depth two; v1 allows one level below platform, so set it to "platform"`,
  );
});

test("kore validate refuses a record whose metadata.name differs from its file name", async () => {
  await records({ [`${dir}/payments.json`]: suborg("api") });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/payments.json: metadata.name "api" must equal the file name "payments" without .json; rename the file or the name`,
  );
});

/** The copied local overlay with platform-hostname-ownership on; split puts it on a split domain with an external Gateway. */
async function flagOn(split: boolean): Promise<void> {
  const path = join(root, "infra/environments/local/environment.yaml");
  const overlay = JSON.parse(await readFile(path, "utf8")) as Overlay;
  overlay.features = {
    ...overlay.features,
    "platform-hostname-ownership": true,
    "service-listener-sets": true,
  };
  if (split) {
    overlay.platform = {
      domain: "example.com",
      organizationId: "platform",
      internalDomain: "internal.example.com",
    };
    overlay.gateways = {
      ...overlay.gateways,
      external: {
        namespace: "kore-system",
        name: "kore-gateway-external",
        port: 443,
        issuer: "acme-production",
      },
    };
  }
  await writeFile(path, JSON.stringify(overlay, null, 2));
}

interface Overlay {
  features: Record<string, boolean>;
  platform?: unknown;
  gateways: Record<string, unknown>;
}

test("kore validate with platform-hostname-ownership on refuses a suborg with no internal zone, naming the default it must state", async () => {
  await flagOn(true);
  await records({ [`${dir}/api.json`]: suborg("api") });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/api.json.spec.internalZone: is required while platform-hostname-ownership is on; set it to api.internal.example.com, the suborg's default internal zone`,
  );
});

test("kore validate with platform-hostname-ownership on passes a suborg whose internal zone is its default, and reports its public zone", async () => {
  await flagOn(true);
  await records({
    [`${dir}/api.json`]: suborg("api", {
      internalZone: "api.internal.example.com",
    }),
  });
  expect(await main(["validate", "--json"])).toBe(0);
  const report = JSON.parse(output()) as {
    organizations: { name: string; zone: string }[];
  };
  expect(report.organizations).toEqual([
    { name: "api", zone: "api.example.com" },
  ]);
});

test("kore validate refuses a suborg internal zone equal to its public zone on a split-domain platform, with the exact text", async () => {
  await flagOn(true);
  await records({
    [`${dir}/api.json`]: suborg("api", { internalZone: "api.example.com" }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/api.json.spec.internalZone "api.example.com" equals the public zone api.example.com: the two zones of one organization never coincide on a platform with an external Gateway; set it to api.internal.example.com, the suborg's default internal zone`,
  );
});

test("kore validate refuses a suborg internal zone outside the internal domain, naming the domain and the default", async () => {
  await flagOn(true);
  await records({
    [`${dir}/api.json`]: suborg("api", { internalZone: "api.example.org" }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/api.json.spec.internalZone "api.example.org" is outside the internal domain internal.example.com: set it to api.internal.example.com, the suborg's default internal zone`,
  );
});

test("kore validate on a one-domain platform with the flag on passes a suborg whose internal zone is its public zone", async () => {
  await flagOn(false);
  await records({
    [`${dir}/api.json`]: suborg("api", { internalZone: "api.kore.internal" }),
  });
  expect(await main(["validate", "--json"])).toBe(0);
  const report = JSON.parse(output()) as {
    organizations: { name: string; zone: string }[];
  };
  expect(report.organizations).toEqual([
    { name: "api", zone: "api.kore.internal" },
  ]);
});
