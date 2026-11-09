import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createTcp, type Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTls, type Server as TlsServer } from "node:tls";
import { afterAll, afterEach, expect, test } from "vitest";
import { forwardResponds } from "./registry.js";

// A kubectl port-forward whose pod was replaced keeps its listener until the
// first request, then exits. Only an answered HTTPS request, verified against
// the registry CA, proves the forward (ADR 0058).

const dir = mkdtempSync(join(tmpdir(), "kore-forward-probe-"));
const openssl = (args: string[]) =>
  execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
function authority(name: string) {
  openssl([
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.crt`,
    "-subj",
    `/CN=${name}`,
    "-days",
    "1",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=keyCertSign",
  ]);
}
authority("ca");
authority("other");
openssl([
  "req",
  "-newkey",
  "ec",
  "-pkeyopt",
  "ec_paramgen_curve:prime256v1",
  "-nodes",
  "-keyout",
  "leaf.key",
  "-out",
  "leaf.csr",
  "-subj",
  "/CN=registry",
]);
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(join(dir, "ext.cnf"), "subjectAltName=IP:127.0.0.1\n"),
);
openssl([
  "x509",
  "-req",
  "-in",
  "leaf.csr",
  "-CA",
  "ca.crt",
  "-CAkey",
  "ca.key",
  "-CAcreateserial",
  "-out",
  "leaf.crt",
  "-days",
  "1",
  "-extfile",
  "ext.cnf",
]);
const read = (name: string) => readFileSync(join(dir, name), "utf8");
afterAll(() => rmSync(dir, { force: true, recursive: true }));

const servers: (TcpServer | TlsServer)[] = [];
async function listen(server: TcpServer | TlsServer): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no port");
  }
  return address.port;
}
const tls = (onSocket: (socket: import("node:tls").TLSSocket) => void) =>
  createTls({ key: read("leaf.key"), cert: read("leaf.crt") }, onSocket);

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

test("a forward that answers an HTTPS request verified against the CA is ready", async () => {
  const port = await listen(
    tls((socket) => {
      socket.once("data", () =>
        socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"),
      );
    }),
  );
  expect(await forwardResponds(port, read("ca.crt"))).toBe(true);
});

test("a forward whose certificate the CA did not sign is never ready, so verification is not skipped", async () => {
  const port = await listen(
    tls((socket) =>
      socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\n\r\n")),
    ),
  );
  expect(await forwardResponds(port, read("other.crt"))).toBe(false);
});

test("a plain-HTTP listener is never ready", async () => {
  const port = await listen(
    createTcp((socket) =>
      socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\n\r\n")),
    ),
  );
  expect(await forwardResponds(port, read("ca.crt"), 500)).toBe(false);
});

test("a stale forward that accepts the connection but drops the request is not ready", async () => {
  const port = await listen(createTcp((socket) => socket.destroy()));
  expect(await forwardResponds(port, read("ca.crt"))).toBe(false);
});

test("a forward that accepts but never answers is not ready", async () => {
  const port = await listen(tls((socket) => socket.resume()));
  expect(await forwardResponds(port, read("ca.crt"), 300)).toBe(false);
});

test("a closed port is not ready", async () => {
  const port = await listen(createTcp());
  await new Promise((resolve) => servers.pop()!.close(resolve));
  expect(await forwardResponds(port, read("ca.crt"))).toBe(false);
});
