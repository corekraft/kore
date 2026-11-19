import { expect, test, vi } from "vitest";
import type { K3dCluster } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { commandLines, fakeRunner } from "./cluster-support.js";
import { checkHostPorts, type PortProbe } from "./k3d-ports.js";

const local: K3dCluster = {
  clusterName: "kore-local",
  serviceCidr: "10.96.0.0/12",
  ports: [{ hostAddress: "127.0.0.1", hostPort: 8443, loadBalancerPort: 443 }],
};

/** A runner whose every command fails with the given error, as lsof does when it finds nothing or is missing. */
function failingRunner(error: unknown) {
  const run = vi.fn<Runner["run"]>(async () => {
    throw error;
  });
  return { runner: { run } as Runner, run };
}

test("a taken loopback host port is refused before any cluster command, naming the port, its overlay setting and the process holding it", async () => {
  const probe = vi.fn<PortProbe>(async () => false);
  const { runner, run } = fakeRunner(() => "p4242\ncnginx\n");
  await expect(checkHostPorts("local", local, runner, probe)).rejects.toThrow(
    new Error(
      "host port 127.0.0.1:8443 is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[0] (loadBalancerPort 443) in environment local. Holder: nginx (pid 4242). Free the port by stopping the process holding it, or change k3d.ports[0].hostPort, then rerun kore local up --environment local.",
    ),
  );
  expect(probe).toHaveBeenCalledWith("127.0.0.1", 8443, "tcp");
  expect(commandLines(run)).toEqual(["lsof -nP -iTCP:8443 -sTCP:LISTEN -Fpc"]);
});

test("a taken UDP mapping is probed and looked up over UDP, so the refusal names /udp and a TCP listener is not the holder", async () => {
  const udp: K3dCluster = {
    ...local,
    ports: [
      {
        hostAddress: "127.0.0.1",
        hostPort: 53,
        loadBalancerPort: 53,
        protocol: "udp",
      },
    ],
  };
  const probe = vi.fn<PortProbe>(async () => false);
  const { runner, run } = fakeRunner(() => "p4242\ncnamed\n");
  await expect(checkHostPorts("local", udp, runner, probe)).rejects.toThrow(
    new Error(
      "host port 127.0.0.1:53/udp is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[0] (loadBalancerPort 53) in environment local. Holder: named (pid 4242). Free the port by stopping the process holding it, or change k3d.ports[0].hostPort, then rerun kore local up --environment local.",
    ),
  );
  expect(probe).toHaveBeenCalledWith("127.0.0.1", 53, "udp");
  expect(commandLines(run)).toEqual(["lsof -nP -iUDP:53 -Fpc"]);
});

test("a taken host port whose holder lsof cannot name is refused, saying plainly that the holder could not be identified", async () => {
  const probe = vi.fn<PortProbe>(async () => false);
  const { runner } = failingRunner(
    new CommandError("lsof", [], { stdout: "", stderr: "", code: 1 }),
  );
  await expect(checkHostPorts("local", local, runner, probe)).rejects.toThrow(
    new Error(
      "host port 127.0.0.1:8443 is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[0] (loadBalancerPort 443) in environment local. The holder could not be identified: lsof reported none or is not installed. Free the port by stopping the process holding it, or change k3d.ports[0].hostPort, then rerun kore local up --environment local.",
    ),
  );
});

test("a missing lsof is an unidentified holder, not a raw spawn error", async () => {
  const probe = vi.fn<PortProbe>(async () => false);
  const missing = Object.assign(new Error("spawn lsof ENOENT"), {
    code: "ENOENT",
  });
  const { runner } = failingRunner(missing);
  await expect(checkHostPorts("local", local, runner, probe)).rejects.toThrow(
    new Error(
      "host port 127.0.0.1:8443 is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[0] (loadBalancerPort 443) in environment local. The holder could not be identified: lsof reported none or is not installed. Free the port by stopping the process holding it, or change k3d.ports[0].hostPort, then rerun kore local up --environment local.",
    ),
  );
});

test("a runner failure that is neither lsof's no-match exit nor a missing binary is rethrown, not reported as an unidentified holder", async () => {
  const probe = vi.fn<PortProbe>(async () => false);
  const boom = new Error("lsof exploded");
  const { runner } = failingRunner(boom);
  await expect(checkHostPorts("local", local, runner, probe)).rejects.toBe(
    boom,
  );
});

test("a free host port passes with no holder lookup", async () => {
  const probe = vi.fn<PortProbe>(async () => true);
  const { runner, run } = fakeRunner();
  await expect(
    checkHostPorts("local", local, runner, probe),
  ).resolves.toBeUndefined();
  expect(probe).toHaveBeenCalledWith("127.0.0.1", 8443, "tcp");
  expect(commandLines(run)).toEqual([]);
});

test("an optional port is skipped: it is neither probed nor refused, even when taken", async () => {
  const optional: K3dCluster = {
    ...local,
    ports: [{ ...local.ports[0]!, optional: true }],
  };
  const probe = vi.fn<PortProbe>(async () => false);
  const { runner, run } = fakeRunner();
  await expect(
    checkHostPorts("local", optional, runner, probe),
  ).resolves.toBeUndefined();
  expect(probe).not.toHaveBeenCalled();
  expect(commandLines(run)).toEqual([]);
});

test("every taken host port is named in the refusal, not only the first", async () => {
  const two: K3dCluster = {
    ...local,
    ports: [
      ...local.ports,
      { hostAddress: "127.0.0.2", hostPort: 9000, loadBalancerPort: 30000 },
    ],
  };
  const probe = vi.fn<PortProbe>(async () => false);
  const { runner, run } = fakeRunner(() => "p4242\ncnginx\n");
  await expect(checkHostPorts("local", two, runner, probe)).rejects.toThrow(
    new Error(
      [
        "host port 127.0.0.1:8443 is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[0] (loadBalancerPort 443) in environment local. Holder: nginx (pid 4242). Free the port by stopping the process holding it, or change k3d.ports[0].hostPort, then rerun kore local up --environment local.",
        "host port 127.0.0.2:9000 is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[1] (loadBalancerPort 30000) in environment local. Holder: nginx (pid 4242). Free the port by stopping the process holding it, or change k3d.ports[1].hostPort, then rerun kore local up --environment local.",
      ].join("\n"),
    ),
  );
  expect(commandLines(run)).toEqual([
    "lsof -nP -iTCP:8443 -sTCP:LISTEN -Fpc",
    "lsof -nP -iTCP:9000 -sTCP:LISTEN -Fpc",
  ]);
});
