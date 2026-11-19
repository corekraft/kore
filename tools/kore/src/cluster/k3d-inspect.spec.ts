import { expect, test } from "vitest";
import { CommandError } from "../runtime/index.js";
import { commandLines, fakeRunner } from "./cluster-support.js";
import { inspectPortMappings, loadBalancerContainer } from "./k3d-inspect.js";

const INSPECT =
  "docker inspect --format {{json .NetworkSettings.Ports}} k3d-kore-local-serverlb";

test("the load balancer's port bindings are read by inspecting its container, which k3d names for the cluster", async () => {
  const { runner, run } = fakeRunner(
    () =>
      '{"443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8443"}],"6443/tcp":null}',
  );
  expect(loadBalancerContainer("kore-local")).toBe("k3d-kore-local-serverlb");
  expect(await inspectPortMappings(runner, "kore-local")).toEqual({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    "6443/tcp": null,
  });
  expect(commandLines(run)).toEqual([INSPECT]);
});

test("a container that cannot be inspected reports no bindings, so the caller names the gap", async () => {
  const { runner } = fakeRunner(() => {
    throw new CommandError("docker", ["inspect"], {
      stdout: "",
      stderr: "No such container",
      code: 1,
    });
  });
  expect(await inspectPortMappings(runner, "kore-local")).toBeUndefined();
});

test("docker printing null for the bindings reads as no bindings, not as unreadable", async () => {
  const { runner } = fakeRunner(() => "null");
  expect(await inspectPortMappings(runner, "kore-local")).toEqual({});
});

test("a failure that is not a command failing, such as docker not starting, is raised as it is", async () => {
  const { runner } = fakeRunner(() => {
    throw new Error("spawn docker ENOENT");
  });
  await expect(inspectPortMappings(runner, "kore-local")).rejects.toThrow(
    "spawn docker ENOENT",
  );
});

test("unreadable inspect output is named and never read as no bindings", async () => {
  const { runner } = fakeRunner(() => "not json");
  await expect(inspectPortMappings(runner, "kore-local")).rejects.toThrow(
    `docker ${INSPECT.slice("docker ".length)} printed unreadable output, not JSON: not json`,
  );
});
