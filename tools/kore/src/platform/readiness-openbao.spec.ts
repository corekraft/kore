// Docs: docs/decisions/0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md
// Docs: docs/decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";
import { openbaoCheck } from "./readiness-openbao.js";

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

const RESOURCE = "statefulset/openbao";
const base = ["--context", "vps-kore", "--namespace", "openbao"];

const status = (state: { initialized: boolean; sealed: boolean }) =>
  JSON.stringify({ type: "static", ...state, t: 1, n: 1 });

/** A runner that answers the status read and the audit file test by the command they run in the pod. */
function fakeRunner(replies: {
  status: string | Error;
  audit?: string | Error;
}) {
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    const reply = args.some((arg) => arg.includes("bao status"))
      ? replies.status
      : replies.audit;
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

function checkWith(replies: {
  status: string | Error;
  audit?: string | Error;
}) {
  const { runner, run } = fakeRunner(replies);
  const check = openbaoCheck({ runner, base }, RESOURCE);
  return { check, run };
}

test("an initialised, unsealed OpenBao with its audit file passes", async () => {
  const { check } = checkWith({
    status: status({ initialized: true, sealed: false }),
    audit: "audit",
  });
  await expect(check?.run("0s")).resolves.toBeUndefined();
});

test("a sealed OpenBao fails naming sealed and the seal key, never passing", async () => {
  const { check } = checkWith({
    status: status({ initialized: true, sealed: true }),
    audit: "audit",
  });
  await expect(check?.run("0s")).rejects.toThrow(/OpenBao is sealed/);
  await expect(check?.run("0s")).rejects.toThrow(/static-seal\.key/);
});

test("an uninitialised OpenBao fails naming uninitialised, not sealed, although it reports sealed too", async () => {
  const { check } = checkWith({
    status: status({ initialized: false, sealed: true }),
    audit: "audit",
  });
  const failure = check?.run("0s");
  await expect(failure).rejects.toThrow(/OpenBao is uninitialised/);
  await expect(failure).rejects.not.toThrow(/OpenBao is sealed/);
});

test("an OpenBao with no audit device fails naming the missing audit device", async () => {
  const { check } = checkWith({
    status: status({ initialized: true, sealed: false }),
    audit: "none",
  });
  await expect(check?.run("0s")).rejects.toThrow(/OpenBao has no audit device/);
});

test("a sealed OpenBao is refused before the audit file is read, so a sealed pod never passes on a stale audit file", async () => {
  const { check, run } = checkWith({
    status: status({ initialized: true, sealed: true }),
  });
  await expect(check?.run("0s")).rejects.toThrow(/OpenBao is sealed/);
  expect(run).toHaveBeenCalledTimes(1);
});

test("the three failures read differently, so a person can tell them apart", async () => {
  const messages: string[] = [];
  for (const replies of [
    { status: status({ initialized: false, sealed: true }), audit: "audit" },
    { status: status({ initialized: true, sealed: true }), audit: "audit" },
    { status: status({ initialized: true, sealed: false }), audit: "none" },
  ]) {
    const { check } = checkWith(replies);
    await check
      ?.run("0s")
      .catch((error: Error) => messages.push(error.message));
  }
  expect(new Set(messages).size).toBe(3);
});

test("an answer that is not the status JSON fails closed instead of passing", async () => {
  const { check } = checkWith({ status: "", audit: "audit" });
  await expect(check?.run("0s")).rejects.toThrow(
    /OpenBao did not answer with its status/,
  );
});

test("a status JSON without the initialised and sealed fields fails closed", async () => {
  const { check } = checkWith({ status: "{}", audit: "audit" });
  await expect(check?.run("0s")).rejects.toThrow(
    /OpenBao did not answer with its status/,
  );
});

test("a pod that is not running yet is waited for, naming the pod", async () => {
  const { check } = checkWith({
    status: new Error(
      'Error from server (NotFound): pods "openbao-0" not found',
    ),
  });
  await expect(check?.run("0s")).rejects.toThrow(/openbao-0 is not running/);
});

test("a container that has not started is waited for, naming the pod", async () => {
  const { check } = checkWith({
    status: new Error(
      'error: unable to upgrade connection: container not found ("openbao")',
    ),
  });
  await expect(check?.run("0s")).rejects.toThrow(/openbao-0 is not running/);
});

test("any other kubectl failure is not swallowed as a wait", async () => {
  const { check } = checkWith({
    status: new Error("Forbidden: pods/exec is forbidden"),
  });
  await expect(check?.run("0s")).rejects.toThrow(/Forbidden/);
  await expect(check?.run("0s")).rejects.not.toThrow(/not running/);
});

test("the status and the audit file are read inside the openbao container of pod openbao-0, in the environment's context and the component's namespace", async () => {
  const { check, run } = checkWith({
    status: status({ initialized: true, sealed: false }),
    audit: "audit",
  });
  await check?.run("0s");
  for (const call of run.mock.calls) {
    expect(call[0]).toBe("kubectl");
    expect(call[1].slice(0, 9)).toEqual([
      "--context",
      "vps-kore",
      "--namespace",
      "openbao",
      "exec",
      "openbao-0",
      "--container",
      "openbao",
      "--",
    ]);
  }
});

test("the check reads state only: nothing it runs in the pod writes, unseals or initialises", async () => {
  const { check, run } = checkWith({
    status: status({ initialized: true, sealed: false }),
    audit: "audit",
  });
  await check?.run("0s");
  const commands = run.mock.calls.map((call) => call[1].join(" "));
  for (const command of commands) {
    expect(command).not.toMatch(/operator (init|unseal)|write|delete/);
  }
});

test("another resource is left to the other checks, so only the openbao StatefulSet is read here", () => {
  const { runner } = fakeRunner({ status: "" });
  expect(
    openbaoCheck({ runner, base }, "statefulset/keycloak"),
  ).toBeUndefined();
  expect(openbaoCheck({ runner, base }, "deployment/openbao")).toBeUndefined();
});
