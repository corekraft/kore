import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import {
  postOtlp,
  waitForOtlp,
  withForward,
  type ForwardChild,
} from "./otlp-forward.js";

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

const reset = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    }),
  });
const noWait = async () => undefined;

test("an OTLP post retries a reset connection and then succeeds", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    if (calls < 3) {
      throw reset();
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await postOtlp(1, "logs", {}, fetchFn, noWait);
  assert.equal(calls, 3);
});

test("an OTLP post gives up after a bounded number of resets", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    throw reset();
  }) as unknown as typeof fetch;
  await assert.rejects(
    postOtlp(1, "logs", {}, fetchFn, noWait),
    /fetch failed/,
  );
  assert.equal(calls, 5);
});

test("an OTLP post does not retry a rejection by the Collector", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    return new Response("bad", { status: 400 });
  }) as unknown as typeof fetch;
  await assert.rejects(postOtlp(1, "logs", {}, fetchFn, noWait), /400/);
  assert.equal(calls, 1);
});

test("the forward is ready only once the receiver answers an HTTP request", async () => {
  let calls = 0;
  const fetchFn = (async (url: string) => {
    calls += 1;
    assert.equal(url, "http://127.0.0.1:4000/v1/traces");
    if (calls < 3) {
      throw reset();
    }
    return new Response("", { status: 405 });
  }) as unknown as typeof fetch;
  await waitForOtlp(4000, fetchFn, noWait);
  assert.equal(calls, 3);
});

test("a forward that never answers fails naming the port", async () => {
  const fetchFn = (async () => {
    throw reset();
  }) as unknown as typeof fetch;
  await assert.rejects(
    waitForOtlp(4000, fetchFn, noWait),
    /4000.*did not answer/,
  );
});
