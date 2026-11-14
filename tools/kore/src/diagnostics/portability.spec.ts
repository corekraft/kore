// Docs: docs/decisions/0012-environment-overlays-hold-provider-specifics.md
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import {
  fakeFileTree,
  fakeRepository,
  fakeRunner,
} from "./diagnostics-support.js";
import { validatePortability } from "./portability.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const hint =
  "move provider names into the environment overlay; applications stay provider-neutral";
const workload = "/repo/apps/example/charts/workload/templates/deployment.yaml";

/** The files of one application, `name`, whose workload template is `template`. */
function application(
  name: string,
  template = "kind: Deployment\n",
): Record<string, string> {
  const chart = `/repo/apps/${name}/charts`;
  return {
    [`${chart}/resources/Chart.yaml`]: "name: resources\n",
    [`${chart}/resources/templates/configmap.yaml`]: "kind: ConfigMap\n",
    [`${chart}/workload/Chart.yaml`]: "name: workload\n",
    [`${chart}/workload/templates/deployment.yaml`]: template,
  };
}

const repository = fakeRepository({
  name: "managed-example",
  provider: "managed",
});

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("portability accepts an application whose charts carry no provider names", async () => {
  fakeFileTree(application("example"));
  const { runner } = fakeRunner();
  expect(await validatePortability(repository, runner)).toEqual({
    environment: "managed-example",
    applications: ["example"],
  });
});

test("portability validates only directories named like applications, in sorted order", async () => {
  fakeFileTree({
    ...application("example"),
    ...application("alpha"),
    "/repo/apps/README.md": "# apps\n",
    "/repo/apps/Bad_Name/Chart.yaml": "name: unlisted\n",
  });
  const { runner } = fakeRunner();
  expect((await validatePortability(repository, runner)).applications).toEqual([
    "alpha",
    "example",
  ]);
});

test("portability names the apps directory when the repository has none", async () => {
  fakeFileTree({});
  const { runner } = fakeRunner();
  await expect(validatePortability(repository, runner)).rejects.toThrow(
    /^portability validation requires an apps directory$/,
  );
});

test("portability rejects a repository whose apps directory holds no application", async () => {
  fakeFileTree({ "/repo/apps/README.md": "" });
  const { runner } = fakeRunner();
  await expect(validatePortability(repository, runner)).rejects.toThrow(
    /^portability validation found no applications$/,
  );
});

test("portability reports an application chart that has no Chart.yaml", async () => {
  const files = application("example");
  delete files["/repo/apps/example/charts/resources/Chart.yaml"];
  fakeFileTree(files);
  const { runner } = fakeRunner();
  await expect(validatePortability(repository, runner)).rejects.toThrow(
    /^example: missing resources chart$/,
  );
});

test.each([
  ["kind: DaemonSet\n# minikube-only\n", "minikube"],
  ["provisioner: rancher.io/local-path\n", "rancher.io/local-path"],
  ["storageClassName: local-path\n", "storageClassName: local-path"],
  ["image: rancher/k3s:v1\n", "k3s"],
  ["cluster: k3d-kore\n", "k3d"],
  ["token: ${k3s_token}\n", "k3s"],
  ["path: local_path\n", "local_path"],
])(
  "portability rejects an application template that names %j",
  async (template, token) => {
    fakeFileTree(application("example", template));
    const { runner } = fakeRunner();
    await expect(validatePortability(repository, runner)).rejects.toThrow(
      `example: provider-specific reference ${token} in ${workload}; ${hint}`,
    );
  },
);

test.each([
  "cache-local-path: enabled\n",
  "mountPath: /data/local-path/cache\n",
])("portability accepts the neutral template line %j", async (template) => {
  fakeFileTree(application("example", template));
  const { runner } = fakeRunner();
  expect((await validatePortability(repository, runner)).applications).toEqual([
    "example",
  ]);
});

test("portability rejects an application chart that imports an environment overlay", async () => {
  fakeFileTree(
    application(
      "example",
      "values: infra/environments/local/values/platform-config.yaml\n",
    ),
  );
  const { runner } = fakeRunner();
  await expect(validatePortability(repository, runner)).rejects.toThrow(
    `example: environment overlay reference infra/environments/ in ${workload}`,
  );
});

test("portability renders each application chart with common values only", async () => {
  fakeFileTree(application("example"));
  const { runner, run } = fakeRunner();
  await validatePortability(repository, runner);
  expect(run.mock.calls).toEqual([
    [
      "helm",
      ["template", "example-resources", "/repo/apps/example/charts/resources"],
      { capture: true },
    ],
    [
      "helm",
      ["template", "example-workload", "/repo/apps/example/charts/workload"],
      { capture: true },
    ],
  ]);
});

test.each([
  ["minikube", "kind: StorageClass\nprovisioner: k8s.io/minikube-hostpath\n"],
  ["k3d", "kind: PersistentVolumeClaim\nstorageClassName: k3d\n"],
  [
    "storageClassName: local-path",
    "kind: PersistentVolumeClaim\nstorageClassName: local-path\n",
  ],
])(
  "portability rejects rendered output that names %s",
  async (token, output) => {
    fakeFileTree(application("example"));
    const { runner } = fakeRunner(() => output);
    await expect(validatePortability(repository, runner)).rejects.toThrow(
      `example: rendered resources chart has provider-specific output ${token}`,
    );
  },
);

test("portability reports a chart that does not render with its common values", async () => {
  fakeFileTree(application("example"));
  const { runner } = fakeRunner(() => {
    throw new Error("helm template failed (1): bad template");
  });
  await expect(validatePortability(repository, runner)).rejects.toThrow(
    "example: resources chart does not render with common values: helm template failed (1): bad template",
  );
});

test("portability reads and lists only inside apps/, never the rest of the repository", async () => {
  fakeFileTree({
    ...application("example"),
    "/repo/infra/environments/local/storage.yaml":
      "provisioner: rancher.io/local-path\n",
  });
  const { runner } = fakeRunner();
  await validatePortability(repository, runner);
  const touched = [
    ...vi.mocked(readdir).mock.calls.map(([path]) => path as string),
    ...vi.mocked(readFile).mock.calls.map(([path]) => path as string),
  ];
  expect(touched.length).toBeGreaterThan(0);
  const outside = touched.filter(
    (path) => path !== "/repo/apps" && !path.startsWith("/repo/apps/"),
  );
  expect(outside).toEqual([]);
});
