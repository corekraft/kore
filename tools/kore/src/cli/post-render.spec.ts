import { beforeEach, expect, test, vi } from "vitest";
import { applyProbePatches } from "../platform/index.js";
import { postRender } from "./post-render.js";

// The entry guard reads argv and the real path; both are node built-ins.
vi.mock("node:fs");
vi.mock("node:url");
vi.mock("../platform/index.js");

const manifest = "kind: Deployment\nmetadata:\n  name: web\n";
const patch = {
  target: { kind: "Deployment", name: "web", container: "app" },
  reason: "r",
  probes: { livenessProbe: { timeoutSeconds: 5 } },
};
const patches = JSON.stringify([patch]);

beforeEach(() => {
  vi.mocked(applyProbePatches).mockReturnValue("PATCHED");
});

test("the post-renderer hands the manifest and the parsed patch array to the probe patcher and returns its result", () => {
  expect(postRender(manifest, [patches])).toBe("PATCHED");
  expect(applyProbePatches).toHaveBeenCalledWith(manifest, [patch]);
});

test("a patch the probe patcher rejects fails the render, so a chart bump cannot drop a patch silently", () => {
  vi.mocked(applyProbePatches).mockImplementation(() => {
    throw new Error("patch target Deployment/web container app not found");
  });
  expect(() => postRender(manifest, [patches])).toThrow(
    "patch target Deployment/web container app not found",
  );
});

test("a missing patch argument is refused before any patch is applied", () => {
  expect(() => postRender(manifest, [])).toThrow(
    "kore-patch expects the patches as one JSON argument",
  );
  expect(applyProbePatches).not.toHaveBeenCalled();
});

test("a patch argument that is not JSON is refused before any patch is applied", () => {
  expect(() => postRender(manifest, ["{"])).toThrow(
    "kore-patch: the patches argument is not valid JSON",
  );
  expect(applyProbePatches).not.toHaveBeenCalled();
});

test("a patch argument that is JSON but not an array is refused before any patch is applied", () => {
  expect(() => postRender(manifest, ['{"a":1}'])).toThrow(
    "kore-patch: the patches argument must be a JSON array",
  );
  expect(applyProbePatches).not.toHaveBeenCalled();
});
