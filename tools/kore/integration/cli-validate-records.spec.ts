// kore validate over a fixture repository, driven through the command. The catalog,
// the environment overlays, the platform-apis chart, the apps and the legacy
// infra/services directory are copied from this repository into a temporary root,
// which KORE_ROOT names; the app records of the fixture are then checked by the
// command. Real yq and git; no cluster is touched.
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const dir = "infra/environments/local/services";
const digest = `sha256:${"a".repeat(64)}`;
const attestation = `ghcr.io/corekraft/kore/leads-attestation@sha256:${"c".repeat(64)}`;
const commit = "b".repeat(40);

let root: string;
let previousRoot: string | undefined;

/** The shared copy: one per file, so each test starts from the real repository. */
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kore-validate-records-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  previousRoot = process.env.KORE_ROOT;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await rm(join(root, "infra"), { recursive: true, force: true });
  await rm(join(root, "apps"), { recursive: true, force: true });
  await cp(new URL("infra/", repository), join(root, "infra"), {
    recursive: true,
  });
  await cp(new URL("apps/", repository), join(root, "apps"), {
    recursive: true,
  });
  // The exemption check reads the ADRs' status lines from docs/decisions.
  await rm(join(root, "docs"), { recursive: true, force: true });
  await cp(
    new URL("docs/decisions/", repository),
    join(root, "docs/decisions"),
    {
      recursive: true,
    },
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

const spec = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name },
    spec: {
      organization: "platform",
      environments: ["local"],
      components: { frontend: {} },
      ...extra,
    },
  });

const release = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "ServiceRelease",
    metadata: { name },
    spec: {
      commit,
      components: { frontend: { digest, attestation } },
      ...extra,
    },
  });

test("kore validate passes a valid spec and release pair, and warns that the immutability base is not checked outside git", async () => {
  await records({
    [`${dir}/leads.json`]: spec("leads"),
    [`${dir}/leads.release.json`]: release("leads"),
  });
  expect(await main(["validate", "--json"])).toBe(0);
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining(
      "warning: the organization immutability check was not run",
    ),
  );
});

test("kore validate refuses an unknown field in a spec file, naming the file, the field and the fields allowed", async () => {
  await records({
    [`${dir}/leads.json`]: spec("leads", { replicas: 3 }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/leads.json: spec.replicas is not a field of this record; the fields here are organization, environments, repository, path, components, soak, gateway, databases, hostnames, backup, allowFrom, secrets`,
  );
});

test("kore validate refuses a flag map in a release file, saying flag state is not in the release file", async () => {
  await records({
    [`${dir}/leads.json`]: spec("leads"),
    [`${dir}/leads.release.json`]: release("leads", {
      flags: { "leads.new-checkout": false },
    }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/leads.release.json: spec.flags: flag state is not in the release file`,
  );
});

test("kore validate refuses a malformed digest, naming the field and the pattern", async () => {
  await records({
    [`${dir}/leads.json`]: spec("leads"),
    [`${dir}/leads.release.json`]: release("leads", {
      components: { frontend: { digest: "sha256:abc", attestation } },
    }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    /spec\.components\.frontend\.digest must match \^sha256:\[0-9a-f\]\{64\}\$/,
  );
});

test("kore validate refuses a name the legacy infra/services registration already declares, listing both paths", async () => {
  await records({
    [`${dir}/golden-path-example.json`]: spec("golden-path-example"),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${dir}/golden-path-example.json and infra/services/golden-path-example.yaml both declare the service golden-path-example`,
  );
});

test("kore validate refuses a --record-base that does not resolve, naming the flag to fix", async () => {
  await records({ [`${dir}/leads.json`]: spec("leads") });
  await expect(
    main(["validate", "--record-base", "no-such-ref"]),
  ).rejects.toThrow("--record-base no-such-ref does not resolve to a commit");
});
