// Minimal PostgreSQL client: startup, optional TLS, SCRAM-SHA-256, simple query.
// Uses only node:net, node:tls and node:crypto (ADR 0024).
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslmode: "disable" | "require";
}

export interface Connection {
  query(sql: string): Promise<string[][]>;
  close(): Promise<void>;
}

export function databaseConfigFromEnv(
  env: Record<string, string | undefined>,
): DatabaseConfig {
  const sslmode = env.PGSSLMODE ?? "require";
  if (sslmode !== "disable" && sslmode !== "require") {
    throw new Error(
      `unsupported PGSSLMODE sslmode "${sslmode}": use "require" or "disable"`,
    );
  }
  return {
    host: env.PGHOST ?? "reference-db-rw",
    port: Number(env.PGPORT ?? "5432"),
    database: env.PGDATABASE ?? "app",
    user: env.PGUSER ?? "app",
    password: env.PGPASSWORD ?? "",
    sslmode,
  };
}

const int32 = (value: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value);
  return b;
};
const cstring = (value: string): Buffer => Buffer.from(`${value}\0`);
const hmac = (key: Buffer, data: string | Buffer): Buffer =>
  createHmac("sha256", key).update(data).digest();

function frontend(type: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(type, "latin1"),
    int32(body.length + 4),
    body,
  ]);
}

function serverError(body: Buffer): Error {
  let message = "unknown server error";
  for (const field of body.toString().split("\0"))
    if (field.startsWith("M")) {
      message = field.slice(1);
      break;
    }
  return new Error(message);
}

class Wire {
  private buffer = Buffer.alloc(0);
  private waiter: (() => void) | undefined;
  private failure: Error | undefined;
  private closed = false;
  socket: Socket;
  constructor(socket: Socket) {
    this.socket = socket;
    this.attach(socket);
  }

  attach(socket: Socket): void {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.wake();
    });
    socket.on("close", () => {
      this.closed = true;
      this.wake();
    });
  }
  private wake(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.();
  }

  async bytes(count: number): Promise<Buffer> {
    while (this.buffer.length < count) {
      if (this.failure) throw this.failure;
      if (this.closed)
        throw new Error("connection closed by the database server");
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
    const out = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return out;
  }

  async message(): Promise<{ type: string; body: Buffer }> {
    const header = await this.bytes(5);
    return {
      type: String.fromCharCode(header[0]!),
      body: Buffer.from(await this.bytes(header.readInt32BE(1) - 4)),
    };
  }
}

function scram(
  password: string,
  firstResponse: (clientFirst: string) => Promise<string>,
  finalResponse: (clientFinal: string) => Promise<string>,
): Promise<void> {
  return (async () => {
    const clientNonce = randomBytes(18).toString("base64");
    const clientFirstBare = `n=,r=${clientNonce}`;
    const serverFirst = await firstResponse(`n,,${clientFirstBare}`);
    const attrs = Object.fromEntries(
      serverFirst.split(",").map((part) => [part[0], part.slice(2)]),
    );
    const nonce = attrs.r,
      salt = attrs.s,
      iterations = Number(attrs.i);
    if (
      !nonce?.startsWith(clientNonce) ||
      !salt ||
      !Number.isInteger(iterations) ||
      iterations < 1
    )
      throw new Error("invalid SCRAM challenge from the database server");
    const salted = pbkdf2Sync(
      password,
      Buffer.from(salt, "base64"),
      iterations,
      32,
      "sha256",
    );
    const clientKey = hmac(salted, "Client Key");
    const withoutProof = `c=biws,r=${nonce}`;
    const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
    const signature = hmac(
      createHash("sha256").update(clientKey).digest(),
      authMessage,
    );
    const proof = Buffer.from(
      clientKey.map((byte, index) => byte ^ signature[index]!),
    );
    const serverFinal = await finalResponse(
      `${withoutProof},p=${proof.toString("base64")}`,
    );
    const expected = hmac(hmac(salted, "Server Key"), authMessage);
    const received = Buffer.from(
      serverFinal.startsWith("v=") ? serverFinal.slice(2) : "",
      "base64",
    );
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      throw new Error(
        "database server signature mismatch: the server did not prove it knows the password",
      );
  })();
}

export async function connect(
  config: DatabaseConfig,
  timeoutMs = 5000,
): Promise<Connection> {
  if (!config.password)
    throw new Error(
      "database password is empty: inject PGPASSWORD from the database password Secret",
    );
  const raw = netConnect({ host: config.host, port: config.port });
  const wire = new Wire(raw);
  const timer = setTimeout(
    () =>
      raw.destroy(
        new Error(`database connection timed out after ${timeoutMs}ms`),
      ),
    timeoutMs,
  );
  const close = async (): Promise<void> => {
    if (wire.socket.destroyed) return;
    wire.socket.end(frontend("X", Buffer.alloc(0)));
    await new Promise<void>((resolve) => {
      wire.socket.once("close", () => resolve());
      setTimeout(() => {
        wire.socket.destroy();
        resolve();
      }, 500).unref();
    });
  };
  try {
    if (config.sslmode === "require") {
      raw.write(Buffer.concat([int32(8), int32(80877103)]));
      const answer = String.fromCharCode((await wire.bytes(1))[0]!);
      if (answer !== "S")
        throw new Error(
          "database server does not support TLS but sslmode=require; refusing to send credentials in plaintext",
        );
      raw.removeAllListeners("data");
      // sslmode=require encrypts without verifying the certificate, as libpq does.
      const secured = tlsConnect({ socket: raw, rejectUnauthorized: false });
      wire.attach(secured as unknown as Socket);
    }
    const params = Buffer.concat([
      cstring("user"),
      cstring(config.user),
      cstring("database"),
      cstring(config.database),
      Buffer.from([0]),
    ]);
    wire.socket.write(
      Buffer.concat([int32(params.length + 8), int32(196608), params]),
    );
    for (;;) {
      const { type, body } = await wire.message();
      if (type === "E") throw serverError(body);
      if (type === "R") {
        const code = body.readInt32BE(0);
        if (code === 0) continue;
        if (code !== 10)
          throw new Error(
            `unsupported database authentication method ${code}: only SCRAM-SHA-256 is supported`,
          );
        if (!body.subarray(4).toString().split("\0").includes("SCRAM-SHA-256"))
          throw new Error("database server does not offer SCRAM-SHA-256");
        const expect = async (code: number): Promise<string> => {
          const reply = await wire.message();
          if (reply.type === "E") throw serverError(reply.body);
          if (reply.type !== "R" || reply.body.readInt32BE(0) !== code)
            throw new Error("unexpected database authentication reply");
          return reply.body.subarray(4).toString();
        };
        await scram(
          config.password,
          async (first) => {
            const data = Buffer.from(first);
            wire.socket.write(
              frontend(
                "p",
                Buffer.concat([
                  cstring("SCRAM-SHA-256"),
                  int32(data.length),
                  data,
                ]),
              ),
            );
            return expect(11);
          },
          async (final) => {
            wire.socket.write(frontend("p", Buffer.from(final)));
            return expect(12);
          },
        );
      } else if (type === "Z") break;
    }
  } catch (error) {
    wire.socket.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return {
    async query(sql: string): Promise<string[][]> {
      wire.socket.write(frontend("Q", cstring(sql)));
      const rows: string[][] = [];
      let failure: Error | undefined;
      for (;;) {
        const { type, body } = await wire.message();
        if (type === "E") failure ??= serverError(body);
        else if (type === "D") {
          const count = body.readInt16BE(0);
          const row: string[] = [];
          let offset = 2;
          for (let i = 0; i < count; i++) {
            const length = body.readInt32BE(offset);
            offset += 4;
            if (length < 0) {
              row.push("");
              continue;
            }
            row.push(body.subarray(offset, offset + length).toString());
            offset += length;
          }
          rows.push(row);
        } else if (type === "Z") break;
      }
      if (failure) throw failure;
      return rows;
    },
    close,
  };
}
