import { EventEmitter } from "node:events";
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { expect, test, vi } from "vitest";
import { bindProbe } from "./k3d-port-probe.js";

vi.mock("node:net", () => ({ createServer: vi.fn() }));
vi.mock("node:dgram", () => ({ createSocket: vi.fn() }));

/** A server whose listen either binds (calls back) or fails with the given error, and records close. */
function fakeServer(failure?: NodeJS.ErrnoException) {
  const server = new EventEmitter() as EventEmitter & {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  server.listen = vi.fn((_options: unknown, callback: () => void) => {
    if (failure) {
      server.emit("error", failure);
    } else {
      callback();
    }
    return server;
  });
  server.close = vi.fn((callback?: () => void) => {
    callback?.();
    return server;
  });
  vi.mocked(createServer).mockReturnValue(server as never);
  return server;
}

/** A UDP socket whose bind either binds (calls back) or fails with the given error, and records close. */
function fakeSocket(failure?: NodeJS.ErrnoException) {
  const socket = new EventEmitter() as EventEmitter & {
    bind: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  socket.bind = vi.fn((_options: unknown, callback: () => void) => {
    if (failure) {
      socket.emit("error", failure);
    } else {
      callback();
    }
    return socket;
  });
  socket.close = vi.fn((callback?: () => void) => {
    callback?.();
    return socket;
  });
  vi.mocked(createSocket).mockReturnValue(socket as never);
  return socket;
}

test("a port another process holds on the address is reported taken, not thrown, and the probe binds only that address exclusively", async () => {
  const server = fakeServer(
    Object.assign(new Error("address in use"), { code: "EADDRINUSE" }),
  );
  await expect(bindProbe("127.0.0.1", 8443, "tcp")).resolves.toBe(false);
  expect(server.listen).toHaveBeenCalledWith(
    { host: "127.0.0.1", port: 8443, exclusive: true },
    expect.any(Function),
  );
});

test("a port that binds is reported free, and the probe listener is closed before the answer", async () => {
  const server = fakeServer();
  await expect(bindProbe("127.0.0.1", 8443, "tcp")).resolves.toBe(true);
  expect(server.close).toHaveBeenCalledTimes(1);
});

test("a bind failure other than address-in-use is rethrown naming the address and port, with the fix, never reported as free or taken", async () => {
  fakeServer(Object.assign(new Error("permission denied"), { code: "EACCES" }));
  await expect(bindProbe("127.0.0.1", 443, "tcp")).rejects.toThrow(
    new Error(
      'cannot check host port 127.0.0.1:443: permission denied. Check that 127.0.0.1 is a loopback address on this host and that this user may bind port 443, or set "optional": true on that k3d.ports entry in the overlay.',
    ),
  );
});

test("a UDP port is probed with a UDP bind on its address, exclusively, and a UDP listener on it reads as taken", async () => {
  const socket = fakeSocket(
    Object.assign(new Error("address in use"), { code: "EADDRINUSE" }),
  );
  await expect(bindProbe("127.0.0.1", 53, "udp")).resolves.toBe(false);
  expect(createSocket).toHaveBeenCalledWith("udp4");
  expect(socket.bind).toHaveBeenCalledWith(
    { address: "127.0.0.1", port: 53, exclusive: true },
    expect.any(Function),
  );
});

test("a UDP port that binds is reported free, and its probe socket is closed before the answer", async () => {
  const socket = fakeSocket();
  await expect(bindProbe("127.0.0.1", 53, "udp")).resolves.toBe(true);
  expect(socket.close).toHaveBeenCalledTimes(1);
});

test("a UDP bind failure other than address-in-use is rethrown naming the port as /udp, with the fix", async () => {
  fakeSocket(Object.assign(new Error("permission denied"), { code: "EACCES" }));
  await expect(bindProbe("127.0.0.1", 53, "udp")).rejects.toThrow(
    new Error(
      'cannot check host port 127.0.0.1:53/udp: permission denied. Check that 127.0.0.1 is a loopback address on this host and that this user may bind port 53/udp, or set "optional": true on that k3d.ports entry in the overlay.',
    ),
  );
});
