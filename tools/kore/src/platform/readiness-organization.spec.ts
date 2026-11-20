// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
import { expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { organizationCheck } from "./readiness-organization.js";

const RESOURCE = "organization.platform.kore.dev/platform";
const context = { base: ["--context", "k3d-kore-local"] };

/**
 * A runner that answers the sentinel read (a go-template) and the JSON read by
 * their arguments. Each reply is text, or an Error that is thrown.
 */
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
  return { runner: { run } as Runner, run };
}

const organization = (conditions: object[]) =>
  JSON.stringify({
    kind: "Organization",
    metadata: { name: "platform" },
    status: { conditions },
  });

function checkWith(replies: {
  sentinel: string | Error;
  json?: string | Error;
}) {
  const { runner, run } = fakeRunner(replies);
  const check = organizationCheck({ runner, ...context }, RESOURCE);
  return { check, run };
}

test("a Ready platform Organization passes at once, from the sentinel alone", async () => {
  const { check, run } = checkWith({ sentinel: "ready" });
  await expect(check?.run("0s")).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledTimes(1);
});

test("the check reads the platform Organization in the environment's kube context", async () => {
  const { check, run } = checkWith({ sentinel: "ready" });
  await check?.run("0s");
  expect(run.mock.calls[0]?.[1].slice(0, 4)).toEqual([
    "--context",
    "k3d-kore-local",
    "get",
    RESOURCE,
  ]);
});

test("another resource is left to the other checks, so only the Organization is read here", () => {
  const { runner } = fakeRunner({ sentinel: "" });
  expect(
    organizationCheck({ runner, ...context }, "statefulset/keycloak"),
  ).toBeUndefined();
});

test("a missing Organization fails with its name and the chart that declares it, not a bare timeout", async () => {
  const { check } = checkWith({
    sentinel: new Error(
      'Error from server (NotFound): organizations.platform.kore.dev "platform" not found',
    ),
  });
  await expect(check?.run("0s")).rejects.toThrow(
    "organization platform does not exist in this cluster; platform-keycloak creates it while platform-portal is on",
  );
});

test("an Organization whose Ready condition is False fails with Crossplane's reason, so a missing realm is named", async () => {
  const { check } = checkWith({
    sentinel: "",
    json: organization([
      {
        type: "Ready",
        status: "False",
        message: "cannot compose the platform realm: Keycloak is unreachable",
      },
    ]),
  });
  await expect(check?.run("0s")).rejects.toThrow(
    "organization platform is not Ready: cannot compose the platform realm: Keycloak is unreachable",
  );
});

test("an Organization with no Ready condition yet is named as not yet Ready", async () => {
  const { check } = checkWith({ sentinel: "", json: organization([]) });
  await expect(check?.run("0s")).rejects.toThrow(
    "organization platform has no Ready condition yet",
  );
});

test("a read the API refuses is rethrown at once, not retried into a timeout", async () => {
  const { check } = checkWith({
    sentinel: new Error(
      "Error from server (Forbidden): organizations is forbidden",
    ),
  });
  await expect(check?.run("0s")).rejects.toThrow(
    "Error from server (Forbidden): organizations is forbidden",
  );
});
