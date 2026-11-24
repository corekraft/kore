// kore validate over a copy of this repository, driven through the command, with service
// records that claim hostnames. The platform chart, the catalog and the overlays are copied,
// so the reserved names come from the real catalog and the real reserved-name list. Real yq
// and git; no cluster is touched. The local environment's platform domain is its placeholder
// kore.internal, so every name here sits under it.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
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
const servicesDir = "infra/environments/local/services";
const reservedList = "infra/catalog/reserved-hostnames.json";

let root: string;
let previousRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kore-validate-hostnames-"));
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

/** A service on the platform organization, listing the given hostnames. */
const service = (name: string, hostnames?: unknown) =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name },
    spec: {
      organization: "platform",
      environments: ["local"],
      components: {
        frontend: {
          resources: { requests: { cpu: "100m", memory: "128Mi" } },
        },
      },
      ...(hostnames === undefined ? {} : { hostnames }),
    },
  });

/** What the command printed to stdout since the test began. */
const written: string[] = [];

function output(): string {
  return written.join("");
}

test("kore validate passes a service whose hostname no other record claims", async () => {
  await records({
    [`${servicesDir}/leads.json`]: service("leads", ["login.kore.internal"]),
  });
  expect(await main(["validate", "--json"])).toBe(0);
  expect(JSON.parse(output())).toMatchObject({ status: "valid" });
});

test("kore validate refuses a second record that claims a name the first holds, naming the holder", async () => {
  await records({
    [`${servicesDir}/leads.json`]: service("leads", ["login.kore.internal"]),
    [`${servicesDir}/quotes.json`]: service("quotes", ["login.kore.internal"]),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${servicesDir}/quotes.json: spec.hostnames[0] "login.kore.internal" is already claimed by ${servicesDir}/leads.json (service leads in suborg platform): the first claim holds a name exclusively; remove it from this record or choose another name`,
  );
});

test("kore validate refuses a hostname the reserved-name list holds, with the file to read", async () => {
  await records({
    [`${servicesDir}/leads.json`]: service("leads", ["www.kore.internal"]),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${servicesDir}/leads.json: spec.hostnames[0] "www.kore.internal" is a reserved name: www cannot be claimed; the reserved names are in ${reservedList}; choose another name, for example www-app.kore.internal`,
  );
});

test("kore validate refuses a reserved-name list that drops a name the app model reserves", async () => {
  const list = JSON.parse(await readFile(join(root, reservedList), "utf8")) as {
    names: string[];
  };
  await records({
    [reservedList]: JSON.stringify({
      names: list.names.filter((name) => name !== "argocd"),
    }),
  });
  await expect(main(["validate"])).rejects.toThrow(
    `${reservedList}: names is missing "argocd", a suborg name the app model reserves (ADR 0165): add it, so no hostname claim takes a suborg's name`,
  );
});

test("kore validate refuses a malformed reserved-name list, naming the file", async () => {
  await records({ [reservedList]: JSON.stringify({ names: "www" }) });
  await expect(main(["validate"])).rejects.toThrow(
    `${reservedList}: names must be an array`,
  );
});
