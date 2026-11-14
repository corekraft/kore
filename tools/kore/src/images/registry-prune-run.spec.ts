import { beforeEach, expect, it, vi } from "vitest";
import { featureEnabled, type Repository } from "../config/index.js";
import { holdsHostLease, type Runner } from "../runtime/index.js";
import { createRegistryAdmin } from "./registry-admin.js";
import { imagesInUse } from "./image-prune.js";
import { lockedDigests } from "./lock-digests.js";
import { withPublishSession, type PublishSession } from "./local-publish.js";
import { pruneRegistryTagsInCluster } from "./registry-prune-run.js";
import {
  pruneRegistryTags,
  type RegistryAdmin,
  type RegistryPruneDependencies,
} from "./registry-prune.js";
import { ensureRegistryForward } from "./registry-service.js";
import { asFake } from "./images-support.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

vi.mock("../config/index.js");
vi.mock("../runtime/index.js");
vi.mock("./registry-admin.js");
vi.mock("./image-prune.js");
vi.mock("./lock-digests.js");
vi.mock("./local-publish.js");
vi.mock("./registry-prune.js");
vi.mock("./registry-service.js");

const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as Repository;
const run = vi.fn();
const runner = asFake<Runner>({ run });
const admin = asFake<RegistryAdmin>({});

beforeEach(() => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(createRegistryAdmin).mockReturnValue(admin);
  vi.mocked(pruneRegistryTags).mockResolvedValue(0);
  vi.mocked(withPublishSession).mockImplementation(
    async (_repository, _runner, action) =>
      await action(
        asFake<PublishSession>({
          ca: "ca-pem",
          client: { authorization: "Basic abc" },
        }),
      ),
  );
});

it("opens no session and touches no registry while the flag is off", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  await pruneRegistryTagsInCluster(repository, runner);
  expect(withPublishSession).not.toHaveBeenCalled();
  expect(ensureRegistryForward).not.toHaveBeenCalled();
  expect(pruneRegistryTags).not.toHaveBeenCalled();
});

it("prunes through the forwarded registry with the push identity, a seven day keep window and the real lease, pod and lock sources", async () => {
  await pruneRegistryTagsInCluster(repository, runner);
  expect(ensureRegistryForward).toHaveBeenCalledWith(repository, runner);
  expect(createRegistryAdmin).toHaveBeenCalledWith(
    expect.objectContaining({ authorization: "Basic abc", ca: "ca-pem" }),
  );
  const dependencies = vi.mocked(pruneRegistryTags).mock
    .calls[0]?.[1] as RegistryPruneDependencies;
  expect(dependencies.admin).toBe(admin);
  expect(dependencies.keepWindowMs).toBe(7 * 24 * 60 * 60 * 1000);
  expect(dependencies.holdsLease).toBe(holdsHostLease);
  await dependencies.podImages();
  expect(imagesInUse).toHaveBeenCalledWith(repository, runner);
  await dependencies.lockedDigests();
  expect(lockedDigests).toHaveBeenCalledWith(repository);
});

it("collects garbage inside the registry container of the configured context", async () => {
  await pruneRegistryTagsInCluster(repository, runner);
  const dependencies = vi.mocked(pruneRegistryTags).mock
    .calls[0]?.[1] as RegistryPruneDependencies;
  await dependencies.collectGarbage();
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "kore-registry",
      "exec",
      "deployment/oci-registry",
      "--container",
      "registry",
      "--",
      "registry",
      "garbage-collect",
      "/etc/distribution/config.yml",
    ],
    { capture: true },
  );
});
