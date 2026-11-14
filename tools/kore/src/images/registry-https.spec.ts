// Docs: docs/decisions/0058-registry-transport-tls.md
import type { ClientRequest, IncomingMessage } from "node:http";
import { request } from "node:https";
import { expect, test, vi } from "vitest";
import { asFake } from "./images-support.js";
import { registryHead } from "./registry-https.js";

vi.mock("node:https");

interface FakeRequest {
  once: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  listener(event: string): (...args: unknown[]) => void;
}

/** A request whose listeners the test fires by hand. */
function fakeRequest(): FakeRequest {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const req: FakeRequest = {
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return req;
    }),
    end: vi.fn(),
    destroy: vi.fn(),
    listener: (event) => listeners.get(event) ?? (() => undefined),
  };
  return req;
}

/** Starts a HEAD with `req` as the request node returns, and returns the response callback. */
function start(req: FakeRequest) {
  vi.mocked(request).mockReturnValue(asFake<ClientRequest>(req));
  const promise = registryHead(
    "https://127.0.0.1:30500/v2/app/manifests/x",
    { accept: "application/vnd.oci.image.manifest.v1+json" },
    "ca-pem",
  );
  const onResponse = vi.mocked(request).mock.calls[0]?.[2] as (
    response: IncomingMessage,
  ) => void;
  return { promise, onResponse };
}

/** A response with the given status and headers, which records that it was drained. */
function response(
  statusCode: number | undefined,
  headers: Record<string, string | string[] | undefined>,
) {
  return asFake<IncomingMessage>({ statusCode, headers, resume: vi.fn() });
}

test("the HEAD goes to the URL with its headers, verified against the CA and never with verification off", async () => {
  const req = fakeRequest();
  const { onResponse } = start(req);
  onResponse(response(200, {}));
  expect(request).toHaveBeenCalledWith(
    "https://127.0.0.1:30500/v2/app/manifests/x",
    {
      method: "HEAD",
      headers: { accept: "application/vnd.oci.image.manifest.v1+json" },
      ca: "ca-pem",
      rejectUnauthorized: true,
      timeout: 30000,
    },
    expect.any(Function),
  );
  expect(req.end).toHaveBeenCalledOnce();
});

test("the call resolves the status and the docker-content-digest header, and drains the response", async () => {
  const req = fakeRequest();
  const { promise, onResponse } = start(req);
  const reply = response(200, { "docker-content-digest": "sha256:abc" });

  onResponse(reply);

  await expect(promise).resolves.toEqual({
    status: 200,
    digest: "sha256:abc",
  });
  expect(reply.resume).toHaveBeenCalledOnce();
});

test("a digest sent as several header values takes the first, and a missing one or status is empty or zero", async () => {
  const cases: [number | undefined, string | string[] | undefined, object][] = [
    [
      404,
      ["sha256:first", "sha256:second"],
      { status: 404, digest: "sha256:first" },
    ],
    [200, undefined, { status: 200, digest: "" }],
    [undefined, "sha256:only", { status: 0, digest: "sha256:only" }],
  ];
  for (const [statusCode, digest, expected] of cases) {
    const req = fakeRequest();
    const { promise, onResponse } = start(req);
    onResponse(response(statusCode, { "docker-content-digest": digest }));
    await expect(promise).resolves.toEqual(expected);
    vi.mocked(request).mockClear();
  }
});

test("a transport error rejects the call with that error", async () => {
  const req = fakeRequest();
  const { promise } = start(req);
  const failure = new Error("connect ECONNREFUSED");

  req.listener("error")(failure);

  await expect(promise).rejects.toBe(failure);
});

test("a request that times out is destroyed with a named error, so the call fails rather than hangs", async () => {
  const req = fakeRequest();
  const { promise } = start(req);

  req.listener("timeout")();

  expect(req.destroy).toHaveBeenCalledOnce();
  const reason = req.destroy.mock.calls[0]?.[0] as Error;
  expect(reason).toBeInstanceOf(Error);
  expect(reason.message).toBe("registry request timed out");
  void promise.catch(() => undefined);
});
