import type { ClientRequest, IncomingMessage } from "node:http";
import { request } from "node:https";
import { expect, test, vi } from "vitest";
import { asFake } from "./images-support.js";
import { registryRequest } from "./registry-https.js";

// Docs: docs/decisions/0058-registry-transport-tls.md

vi.mock("node:https");

type Listener = (...args: unknown[]) => void;

/** Starts a request and returns the listeners the test fires by hand. */
function start(method = "DELETE") {
  const request_ = new Map<string, Listener>();
  const req = {
    once: vi.fn((event: string, listener: Listener) => {
      request_.set(event, listener);
      return req;
    }),
    end: vi.fn(),
    destroy: vi.fn(),
  };
  vi.mocked(request).mockReturnValue(asFake<ClientRequest>(req));
  const promise = registryRequest(method, "https://x/v2/a", { a: "b" }, "ca");
  const respond = vi.mocked(request).mock.calls[0]?.[2] as (
    response: IncomingMessage,
  ) => void;
  return { req, promise, respond, request_ };
}

function reply(headers: IncomingMessage["headers"]) {
  const listeners = new Map<string, Listener>();
  const response = asFake<IncomingMessage>({
    statusCode: 202,
    headers,
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
    }),
    once: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
    }),
  });
  return {
    response,
    fire: (event: string, ...a: unknown[]) => listeners.get(event)?.(...a),
  };
}

test("the request is verified against the CA and resolves status, first header values and the whole body", async () => {
  const { promise, respond } = start();
  const { response, fire } = reply({
    "docker-content-digest": ["sha256:a", "sha256:b"],
    "x-gone": undefined,
  });
  respond(response);
  fire("data", Buffer.from('{"a":'));
  fire("data", Buffer.from("1}"));
  fire("end");
  await expect(promise).resolves.toEqual({
    status: 202,
    headers: { "docker-content-digest": "sha256:a" },
    body: '{"a":1}',
  });
  expect(request).toHaveBeenCalledWith(
    "https://x/v2/a",
    {
      method: "DELETE",
      headers: { a: "b" },
      ca: "ca",
      rejectUnauthorized: true,
      timeout: 30000,
    },
    expect.any(Function),
  );
});

test("a transport error or a timeout fails the call rather than hanging it", async () => {
  const { promise, request_, req } = start("GET");
  request_.get("timeout")?.();
  const [reason] = req.destroy.mock.calls[0] ?? [];
  expect(reason).toEqual(new Error("registry request timed out"));
  const failure = new Error("connect ECONNREFUSED");
  request_.get("error")?.(failure);
  await expect(promise).rejects.toBe(failure);
});
