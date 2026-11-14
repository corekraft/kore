import { expect, test } from "vitest";
import { ClusterUnavailableError } from "./cluster-unavailable.js";

test("a cluster-unavailable error names itself and keeps its message", () => {
  const error = new ClusterUnavailableError("k3d is not available");
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("ClusterUnavailableError");
  expect(error.message).toBe("k3d is not available");
});

test("a cluster-unavailable error keeps the error that caused it", () => {
  const cause = new Error("spawn k3d ENOENT");
  expect(new ClusterUnavailableError("missing", { cause }).cause).toBe(cause);
});

test("a cluster-unavailable error without a cause has none to report", () => {
  expect(new ClusterUnavailableError("missing").cause).toBeUndefined();
});
