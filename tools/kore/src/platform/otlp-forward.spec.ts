import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import { postOtlp, withForward, type ForwardChild } from "./otlp-forward.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function fake(): { child: FakeChild; calls: string[][]; spawn: never } {
  const child = new FakeChild();
  const calls: string[][] = [];
  const spawn = ((_command: string, args: string[]) => {
    calls.push(args);
    return child as unknown as ForwardChild;
  }) as never;
  return { child, calls, spawn };
}

test("a forward binds an ephemeral local port, hands it to the caller, and is killed afterwards", async () => {
  const { child, calls, spawn } = fake();
  const result = await withForward(
    {
      context: "kore-local",
      namespace: "observability",
      target: "service/otel-collector",
      remotePort: 4318,
      spawn,
    },
    async (port) => {
      assert.equal(child.killed, false);
      return port;
    },
    // announce the port as kubectl does
    () => child.stdout.write("Forwarding from 127.0.0.1:43211 -> 4318\n"),
  );
  assert.equal(result, 43211);
  assert.equal(child.killed, true);
  assert.deepEqual(calls[0], [
    "--context",
    "kore-local",
    "--namespace",
    "observability",
    "port-forward",
    "service/otel-collector",
    ":4318",
  ]);
});

test("a forward is killed even when the caller throws", async () => {
  const { child, spawn } = fake();
  await assert.rejects(
    withForward(
      {
        context: "c",
        namespace: "n",
        target: "service/x",
        remotePort: 1,
        spawn,
      },
      async () => {
        throw new Error("boom");
      },
      () => child.stdout.write("Forwarding from 127.0.0.1:5000 -> 1\n"),
    ),
    /boom/,
  );
  assert.equal(child.killed, true);
});

test("a forward that exits before binding fails naming kubectl's error", async () => {
  const { child, spawn } = fake();
  await assert.rejects(
    withForward(
      {
        context: "c",
        namespace: "n",
        target: "service/x",
        remotePort: 1,
        spawn,
      },
      async () => undefined,
      () => {
        child.stderr.write('error: services "x" not found\n');
        child.emit("exit", 1);
      },
    ),
    /not found/,
  );
});

test("OTLP JSON is posted with the application/json content type", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await postOtlp(4000, "traces", { a: 1 }, fetchFn);
  assert.equal(seen?.url, "http://127.0.0.1:4000/v1/traces");
  assert.equal(seen?.init.method, "POST");
  assert.deepEqual(seen?.init.headers, { "Content-Type": "application/json" });
  assert.equal(seen?.init.body, '{"a":1}');
});

test("a rejected OTLP post names the signal and status", async () => {
  const fetchFn = (async () =>
    new Response("nope", { status: 415 })) as unknown as typeof fetch;
  await assert.rejects(postOtlp(1, "logs", {}, fetchFn), /logs.*415/);
});
