import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { httpRouteNames } from "./readiness.js";
import { appUp } from "./up.js";
import {
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  type Call,
} from "./app-fixtures.js";

// Docs: docs/decisions/0013-local-tls-before-gateway.md
// kore app up reports success only once every HTTPRoute the application's
// release rendered is Accepted and ResolvedRefs, read from the release.

const manifest = (...names: string[]) =>
  names
    .map(
      (name) =>
        `---\napiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: ${name}\nspec: {}\n`,
    )
    .join("") +
  "---\napiVersion: v1\nkind: Service\nmetadata:\n  name: not-a-route\n";

const accepted = JSON.stringify({
  status: {
    parents: [
      {
        conditions: [
          { type: "Accepted", status: "True" },
          { type: "ResolvedRefs", status: "True" },
        ],
      },
    ],
  },
});

function cluster(
  calls: Call[],
  routes: string[],
  routeStatus: (name: string) => string,
): Runner {
  const inner = healthyRunner(calls);
  return {
    async run(command, args, options) {
      if (command === "helm" && args[0] === "get" && args[1] === "manifest") {
        calls.push({ command, args });
        const release = args[2];
        return {
          stdout: release === "reference" ? manifest(...routes) : "",
          stderr: "",
          code: 0,
        };
      }
      const route = args.find((arg) => arg.startsWith("httproute/"));
      if (command === "kubectl" && route) {
        calls.push({ command, args });
        return { stdout: routeStatus(route), stderr: "", code: 0 };
      }
      return inner.run(command, args, options);
    },
  };
}

test("app up waits on each HTTPRoute the release rendered, after the rollout", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(
    repository,
    cluster(calls, ["web", "admin"], () => accepted),
    "reference",
    lockedImage(),
    { publicKey: "/tmp/kore.pub" },
  );

  const read = (name: string) =>
    calls.findIndex(({ args }) => args.includes(`httproute/${name}`));
  const rollout = calls.findLastIndex(
    ({ args }) => args[0] === "rollout" || args.includes("rollout"),
  );
  expect(read("web")).toBeGreaterThan(rollout);
  expect(read("admin")).toBeGreaterThan(rollout);
  expect(
    calls
      .filter(({ args }) => args.includes("--namespace"))
      .filter(({ args }) => args.some((a) => a.startsWith("httproute/")))
      .every(({ args }) => args.includes("reference")),
  ).toBe(true);
});

test("app up fails naming the route and the unmet condition, not a bare timeout", async () => {
  const repository = await loadRepository("local");
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const unresolved = JSON.stringify({
    status: {
      parents: [
        {
          conditions: [
            { type: "Accepted", status: "True" },
            {
              type: "ResolvedRefs",
              status: "False",
              reason: "BackendNotFound",
            },
          ],
        },
      ],
    },
  });

  await expect(
    appUp(
      repository,
      cluster([], ["web"], () => unresolved),
      "reference",
      lockedImage(),
      { publicKey: "/tmp/kore.pub", routeTimeout: "1s" },
    ),
  ).rejects.toThrow(
    /httproute\/web.*ResolvedRefs is False \(reason: BackendNotFound\)/s,
  );
});

test("an application that renders no HTTPRoute is not made to wait on one", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(
    repository,
    cluster(calls, [], () => {
      throw new Error("no route should be read");
    }),
    "reference",
    lockedImage(),
    { publicKey: "/tmp/kore.pub" },
  );

  expect(
    calls.some(({ args }) => args.some((a) => a.startsWith("httproute/"))),
  ).toBe(false);
});

test("route names are read from block and flow style metadata alike", () => {
  expect(
    httpRouteNames(
      '---\nkind: HTTPRoute\nmetadata: {name: reference}\n---\nkind: HTTPRoute\nmetadata:\n  labels: {a: b}\n  name: "other"\n---\nkind: Service\nmetadata: {name: skipped}\n',
    ),
  ).toEqual(["reference", "other"]);
});
