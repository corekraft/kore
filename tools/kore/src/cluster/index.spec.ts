// Docs: infra/plans/2-implementation.md#step-6-repository-and-local-cluster-foundation
import { expect, test, vi } from "vitest";
import * as cluster from "./index.js";
import {
  assertExpectedCluster,
  clusterDestroy,
  clusterStatus,
  clusterStop,
  clusterUp,
  ClusterUnavailableError,
} from "./cluster.js";
import { exportRetainedData } from "./export.js";
import { hasVerifiedExport, newestVerifiedExport } from "./export-manifest.js";
import {
  assertRunningK3dMatchesOverlay,
  k3dClusterInfo,
} from "./k3d-cluster.js";
import { restoreRetainedData } from "./restore.js";
import { purgeRetainedResources, retainedResources } from "./retained.js";

vi.mock("./cluster.js");
vi.mock("./export.js");
vi.mock("./export-manifest.js");
vi.mock("./k3d-cluster.js");
vi.mock("./restore.js");
vi.mock("./retained.js");

test("the cluster barrel exposes exactly the cluster domain's public entry points", () => {
  expect(Object.keys(cluster).sort()).toEqual([
    "ClusterUnavailableError",
    "assertExpectedCluster",
    "assertRunningK3dMatchesOverlay",
    "backupJobPolicy",
    "backupObject",
    "backupStamp",
    "buildBackupManifest",
    "clusterDestroy",
    "clusterStatus",
    "clusterStop",
    "clusterUp",
    "credentialFromDocument",
    "decryptBackup",
    "exportRetainedData",
    "hasVerifiedExport",
    "k3dClusterInfo",
    "newestVerifiedExport",
    "pruneBackups",
    "purgeRetainedResources",
    "restoreRetainedData",
    "retainedResources",
    "s3ObjectAdmin",
  ]);
});

test("each cluster barrel entry is the function or class its module exports", () => {
  expect(cluster.assertExpectedCluster).toBe(assertExpectedCluster);
  expect(cluster.assertRunningK3dMatchesOverlay).toBe(
    assertRunningK3dMatchesOverlay,
  );
  expect(cluster.clusterDestroy).toBe(clusterDestroy);
  expect(cluster.clusterStatus).toBe(clusterStatus);
  expect(cluster.clusterStop).toBe(clusterStop);
  expect(cluster.clusterUp).toBe(clusterUp);
  expect(cluster.ClusterUnavailableError).toBe(ClusterUnavailableError);
  expect(cluster.exportRetainedData).toBe(exportRetainedData);
  expect(cluster.hasVerifiedExport).toBe(hasVerifiedExport);
  expect(cluster.k3dClusterInfo).toBe(k3dClusterInfo);
  expect(cluster.newestVerifiedExport).toBe(newestVerifiedExport);
  expect(cluster.restoreRetainedData).toBe(restoreRetainedData);
  expect(cluster.retainedResources).toBe(retainedResources);
  expect(cluster.purgeRetainedResources).toBe(purgeRetainedResources);
});
