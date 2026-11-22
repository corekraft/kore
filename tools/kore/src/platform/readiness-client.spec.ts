// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { clientCheck } from "./readiness-client.js";
import { pollUntil } from "./readiness-poll.js";

vi.mock("./readiness-poll.js");

// One probe, then the reason it gives becomes the failure, as pollUntil does at its bound.
beforeEach(() => {
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
});

const RESOURCE = "client.openidclient.keycloak.m.crossplane.io/backstage";
const context = {
  base: ["--context", "k3d-kore-local", "--namespace", "backstage"],
};

/** A runner that answers the go-template read and the JSON read by their arguments. */
function fakeRunner(replies: {
  sentinel: string | Error;
  json?: string | Error;
}) {
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    const reply = args.some((arg) => arg.startsWith("go-template="))
      ? replies.sentinel
      : replies.json;
    if (reply === undefined) {
      throw new Error(`unexpected kubectl call: ${args.join(" ")}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return { stdout: reply, stderr: "", code: 0 };
  });
  const runner: Runner = { run };
  return { runner, run };
}

const client = (conditions: object[]) =>
  JSON.stringify({
    kind: "Client",
    metadata: { name: "backstage", namespace: "backstage" },
    status: { conditions },
  });

function checkWith(replies: {
  sentinel: string | Error;
  json?: string | Error;
}) {
  const { runner, run } = fakeRunner(replies);
  const check = clientCheck({ runner, ...context }, RESOURCE);
  return { check, run };
}

test("a Ready Backstage client passes at once, from the sentinel alone", async () => {
  const { check, run } = checkWith({ sentinel: "ready" });
  await expect(check?.run("0s")).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledTimes(1);
});

test("the check reads the Backstage client in the environment's context and the component's namespace", async () => {
  const { check, run } = checkWith({ sentinel: "ready" });
  await check?.run("0s");
  expect(run.mock.calls[0]?.[1].slice(0, 6)).toEqual([
    "--context",
    "k3d-kore-local",
    "--namespace",
    "backstage",
    "get",
    RESOURCE,
  ]);
});

test("another resource is left to the other checks, so only the Backstage client is read here", () => {
  const { runner } = fakeRunner({ sentinel: "" });
  expect(
    clientCheck({ runner, ...context }, "deployment/backstage"),
  ).toBeUndefined();
});

test("a missing Backstage client fails with its name and the chart that declares it, not a bare timeout", async () => {
  const { check } = checkWith({
    sentinel: new Error(
      'Error from server (NotFound): clients.openidclient.keycloak.m.crossplane.io "backstage" not found',
    ),
  });
  await expect(check?.run("0s")).rejects.toThrow(
    "client backstage does not exist in namespace backstage; the platform-backstage chart declares it while platform-portal is on",
  );
});

test("a Backstage client whose Ready condition is False fails with Crossplane's reason, so a missing realm is named", async () => {
  const { check } = checkWith({
    sentinel: "",
    json: client([
      {
        type: "Ready",
        status: "False",
        message: "cannot create the client: realm platform is not found",
      },
    ]),
  });
  await expect(check?.run("0s")).rejects.toThrow(
    "client backstage is not Ready: cannot create the client: realm platform is not found",
  );
});

test("a Backstage client with no Ready condition yet is named as not yet Ready", async () => {
  const { check } = checkWith({ sentinel: "", json: client([]) });
  await expect(check?.run("0s")).rejects.toThrow(
    "client backstage has no Ready condition yet",
  );
});

test("a read the API refuses is rethrown at once, not retried into a timeout", async () => {
  const { check } = checkWith({
    sentinel: new Error("Error from server (Forbidden): clients is forbidden"),
  });
  await expect(check?.run("0s")).rejects.toThrow(
    "Error from server (Forbidden): clients is forbidden",
  );
});
