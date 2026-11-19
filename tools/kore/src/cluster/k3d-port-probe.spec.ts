import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { expect, test, vi } from "vitest";
import { bindProbe } from "./k3d-port-probe.js";

vi.mock("node:net", () => ({ createServer: vi.fn() }));

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

test("a port another process holds on the address is reported taken, not thrown, and the probe binds only that address exclusively", async () => {
  const server = fakeServer(
    Object.assign(new Error("address in use"), { code: "EADDRINUSE" }),
  );
  await expect(bindProbe("127.0.0.1", 8443)).resolves.toBe(false);
  expect(server.listen).toHaveBeenCalledWith(
    { host: "127.0.0.1", port: 8443, exclusive: true },
    expect.any(Function),
  );
});

test("a port that binds is reported free, and the probe listener is closed before the answer", async () => {
  const server = fakeServer();
  await expect(bindProbe("127.0.0.1", 8443)).resolves.toBe(true);
  expect(server.close).toHaveBeenCalledTimes(1);
});

test("a bind failure other than address-in-use is rethrown naming the address and port, with the fix, never reported as free or taken", async () => {
  fakeServer(Object.assign(new Error("permission denied"), { code: "EACCES" }));
  await expect(bindProbe("127.0.0.1", 443)).rejects.toThrow(
    new Error(
      'cannot check host port 127.0.0.1:443: permission denied. Check that 127.0.0.1 is a loopback address on this host and that this user may bind port 443, or set "optional": true on that k3d.ports entry in the overlay.',
    ),
  );
});
