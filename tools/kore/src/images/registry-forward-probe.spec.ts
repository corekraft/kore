import { createServer, type Server } from "node:net";
import { afterEach, expect, test } from "vitest";
import { forwardResponds } from "./registry.js";

// A kubectl port-forward whose pod was replaced keeps its listener until the
// first request, then exits. Only an answered request proves the forward.

const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no port");
  }
  return address.port;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

test("a forward that answers an HTTP request is ready", async () => {
  const port = await listen(
    createServer((socket) => {
      socket.once("data", () => {
        socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      });
    }),
  );
  expect(await forwardResponds(port)).toBe(true);
});

test("a stale forward that accepts the connection but drops the request is not ready", async () => {
  const port = await listen(createServer((socket) => socket.destroy()));
  expect(await forwardResponds(port)).toBe(false);
});

test("a forward that accepts but never answers is not ready", async () => {
  const port = await listen(createServer((socket) => socket.resume()));
  expect(await forwardResponds(port, 200)).toBe(false);
});

test("a closed port is not ready", async () => {
  const port = await listen(createServer());
  await new Promise((resolve) => servers.pop()?.close(resolve));
  expect(await forwardResponds(port)).toBe(false);
});
