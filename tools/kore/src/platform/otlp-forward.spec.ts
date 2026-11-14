import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { postOtlp, waitForOtlp, withForward } from "./otlp-forward.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

/** A `spawn` stand-in that hands back the fake child. The one cast meets Node's overloads. */
function fakeSpawn(child: FakeChild): typeof spawn {
  const spawnMock = vi.fn(() => child);
  return spawnMock as unknown as typeof spawn;
}

const forward = (child: FakeChild, spawnFn = fakeSpawn(child)) => ({
  context: "kore-local",
  namespace: "observability",
  target: "service/otel-collector",
  remotePort: 4318,
  spawn: spawnFn,
});

/** A typed `fetch` answering each call with the next reply; a thrown reply rejects. */
function fakeFetch(...replies: (Response | Error)[]) {
  return vi.fn<typeof fetch>(async () => {
    const reply = replies.shift();
    if (reply instanceof Error) {
      throw reply;
    }
    return reply ?? new Response("{}", { status: 200 });
  });
}

const noWait = vi.fn<(milliseconds: number) => Promise<void>>(
  async () => undefined,
);
const reset = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    }),
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a forward binds an ephemeral local port, hands it to the caller, and is killed afterwards", async () => {
  const child = new FakeChild();
  const spawnFn = fakeSpawn(child);
  const result = await withForward(
    forward(child, spawnFn),
    async (port) => {
      expect(child.killed).toBe(false);
      return port;
    },
    // Announce the port as kubectl does.
    () => child.stdout.write("Forwarding from 127.0.0.1:43211 -> 4318\n"),
  );
  expect(result).toBe(43211);
  expect(child.killed).toBe(true);
  expect(spawnFn).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "kore-local",
      "--namespace",
      "observability",
      "port-forward",
      "service/otel-collector",
      ":4318",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
});

test("a forward is killed even when the caller throws", async () => {
  const child = new FakeChild();
  await expect(
    withForward(
      forward(child),
      async () => {
        throw new Error("boom");
      },
      () => child.stdout.write("Forwarding from 127.0.0.1:5000 -> 1\n"),
    ),
  ).rejects.toThrow("boom");
  expect(child.killed).toBe(true);
});

test("a forward that exits before binding fails naming kubectl's error", async () => {
  const child = new FakeChild();
  await expect(
    withForward(
      forward(child),
      async () => undefined,
      () => {
        child.stderr.write('error: services "x" not found\n');
        child.emit("exit", 1);
      },
    ),
  ).rejects.toThrow(
    'port-forward to service/otel-collector exited before binding: error: services "x" not found',
  );
});

test("a forward that never binds fails after 15 seconds and is still killed", async () => {
  const child = new FakeChild();
  const outcome = withForward(forward(child), async () => undefined).catch(
    (error: unknown) => error,
  );

  await vi.advanceTimersByTimeAsync(15_000);

  expect(await outcome).toEqual(
    expect.objectContaining({
      message: expect.stringMatching(
        /^port-forward to service\/otel-collector did not bind within 15s/,
      ),
    }),
  );
  expect(child.killed).toBe(true);
});

test("OTLP JSON is posted with the application/json content type", async () => {
  const fetchFn = fakeFetch();
  await postOtlp(4000, "traces", { a: 1 }, fetchFn, noWait);
  expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:4000/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"a":1}',
  });
});

test("a rejected OTLP post names the signal and the status", async () => {
  const fetchFn = fakeFetch(new Response("nope", { status: 415 }));
  await expect(postOtlp(1, "logs", {}, fetchFn, noWait)).rejects.toThrow(
    "Collector rejected OTLP logs: 415 nope",
  );
});

test("an OTLP post retries a reset connection after a growing wait and then succeeds", async () => {
  const wait = vi.fn<(milliseconds: number) => Promise<void>>(
    async () => undefined,
  );
  const fetchFn = fakeFetch(
    reset(),
    reset(),
    new Response("{}", { status: 200 }),
  );
  await postOtlp(1, "logs", {}, fetchFn, wait);
  expect(fetchFn).toHaveBeenCalledTimes(3);
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
});

test("an OTLP post gives up after five resets and reports the last error", async () => {
  const fetchFn = fakeFetch(reset(), reset(), reset(), reset(), reset());
  await expect(postOtlp(1, "logs", {}, fetchFn, noWait)).rejects.toThrow(
    "fetch failed",
  );
  expect(fetchFn).toHaveBeenCalledTimes(5);
});

test("an OTLP post does not retry a rejection by the Collector", async () => {
  const fetchFn = fakeFetch(new Response("bad", { status: 400 }));
  await expect(postOtlp(1, "logs", {}, fetchFn, noWait)).rejects.toThrow(
    "Collector rejected OTLP logs: 400 bad",
  );
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test("the forward is ready only once the receiver answers an HTTP request", async () => {
  const wait = vi.fn<(milliseconds: number) => Promise<void>>(
    async () => undefined,
  );
  const fetchFn = fakeFetch(
    reset(),
    reset(),
    new Response("", { status: 405 }),
  );
  await waitForOtlp(4000, fetchFn, wait);
  expect(fetchFn).toHaveBeenCalledTimes(3);
  expect(fetchFn).toHaveBeenLastCalledWith("http://127.0.0.1:4000/v1/traces");
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000]);
});

test("a forward that never answers fails naming the port", async () => {
  const fetchFn = vi.fn<typeof fetch>(async () => {
    throw reset();
  });
  await expect(waitForOtlp(4000, fetchFn, noWait)).rejects.toThrow(
    "port-forward on 127.0.0.1:4000 did not answer an HTTP request within 15s",
  );
  expect(fetchFn).toHaveBeenCalledTimes(15);
});
