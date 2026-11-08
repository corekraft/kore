import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { execFileSync } from "node:child_process";

export type QueryResult =
  | { columns?: string[]; rows?: string[][]; tag?: string }
  | { error: string; code?: string };

export interface FakePostgresOptions {
  user: string;
  password: string;
  database: string;
  tls?: boolean;
  forgeServerSignature?: boolean;
  onQuery?: (sql: string) => QueryResult;
  /** Accept queries but never answer them. */
  stallQueries?: boolean;
}

export interface FakePostgres {
  port: number;
  queries: string[];
  startup: Record<string, string>[];
  close(): Promise<void>;
}

function message(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, "latin1");
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

const int32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};
const cstring = (value: string): Buffer => Buffer.from(`${value}\0`);
const auth = (code: number, extra: Buffer = Buffer.alloc(0)): Buffer =>
  message("R", Buffer.concat([int32(code), extra]));
const hmac = (key: Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

function errorResponse(text: string, code: string): Buffer {
  return message(
    "E",
    Buffer.concat([
      Buffer.from("S"),
      cstring("ERROR"),
      Buffer.from("C"),
      cstring(code),
      Buffer.from("M"),
      cstring(text),
      Buffer.from([0]),
    ]),
  );
}

function resultMessages(result: QueryResult): Buffer[] {
  if ("error" in result)
    return [errorResponse(result.error, result.code ?? "XX000")];
  const columns = result.columns ?? [];
  const out: Buffer[] = [];
  if (columns.length > 0) {
    const fields = columns.map((name) =>
      Buffer.concat([
        cstring(name),
        int32(0),
        Buffer.alloc(2),
        int32(25),
        Buffer.alloc(2),
        int32(-1),
        Buffer.alloc(2),
      ]),
    );
    out.push(
      message(
        "T",
        Buffer.concat([Buffer.from([0, columns.length]), ...fields]),
      ),
    );
    for (const row of result.rows ?? []) {
      const cells = row.map((cell) =>
        Buffer.concat([int32(Buffer.byteLength(cell)), Buffer.from(cell)]),
      );
      out.push(
        message("D", Buffer.concat([Buffer.from([0, row.length]), ...cells])),
      );
    }
  }
  out.push(message("C", cstring(result.tag ?? "OK")));
  return out;
}

export function selfSignedCertificate(): { key: string; cert: string } {
  const pem = execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "-",
      "-out",
      "-",
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const key = pem.match(
    /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/,
  )?.[0];
  const cert = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/,
  )?.[0];
  if (!key || !cert)
    throw new Error("openssl did not produce a key and certificate");
  return { key, cert };
}

export async function startFakePostgres(
  options: FakePostgresOptions,
): Promise<FakePostgres> {
  const queries: string[] = [];
  const startup: Record<string, string>[] = [];
  const sockets = new Set<Socket>();
  const tlsMaterial = options.tls ? selfSignedCertificate() : undefined;

  const serve = (stream: Socket): void => {
    let buffer = Buffer.alloc(0);
    let phase: "startup" | "sasl-initial" | "sasl-final" | "ready" = "startup";
    let clientFirstBare = "";
    let serverFirst = "";
    let salted = Buffer.alloc(0);
    stream.on("error", () => undefined);

    const drain = (): void => {
      for (;;) {
        if (phase === "startup") {
          if (buffer.length < 8) return;
          const length = buffer.readInt32BE(0);
          if (buffer.length < length) return;
          const code = buffer.readInt32BE(4);
          const body = buffer.subarray(8, length);
          buffer = buffer.subarray(length);
          if (code === 80877103) {
            if (tlsMaterial) {
              stream.write("S");
              stream.removeAllListeners("data");
              const secured = new TLSSocket(stream, {
                isServer: true,
                key: tlsMaterial.key,
                cert: tlsMaterial.cert,
              });
              sockets.add(secured as unknown as Socket);
              serve(secured as unknown as Socket);
              return;
            }
            stream.write("N");
            continue;
          }
          const parts = body.toString().split("\0");
          const params: Record<string, string> = {};
          for (
            let index = 0;
            index + 1 < parts.length && parts[index] !== "";
            index += 2
          )
            params[parts[index]!] = parts[index + 1]!;
          startup.push(params);
          phase = "sasl-initial";
          stream.write(
            auth(
              10,
              Buffer.concat([cstring("SCRAM-SHA-256"), Buffer.from([0])]),
            ),
          );
          continue;
        }
        if (buffer.length < 5) return;
        const length = buffer.readInt32BE(1);
        if (buffer.length < length + 1) return;
        const type = String.fromCharCode(buffer[0]!);
        const body = buffer.subarray(5, length + 1);
        buffer = buffer.subarray(length + 1);
        if (phase === "sasl-initial" && type === "p") {
          const mechEnd = body.indexOf(0);
          const dataLength = body.readInt32BE(mechEnd + 1);
          const clientFirst = body
            .subarray(mechEnd + 5, mechEnd + 5 + dataLength)
            .toString();
          clientFirstBare = clientFirst.replace(/^n,,/, "");
          const clientNonce = /r=([^,]+)/.exec(clientFirstBare)![1]!;
          const salt = randomBytes(16);
          serverFirst = `r=${clientNonce}${randomBytes(12).toString("base64")},s=${salt.toString("base64")},i=4096`;
          salted = pbkdf2Sync(options.password, salt, 4096, 32, "sha256");
          phase = "sasl-final";
          stream.write(auth(11, Buffer.from(serverFirst)));
        } else if (phase === "sasl-final" && type === "p") {
          const clientFinal = body.toString();
          const withoutProof = clientFinal.slice(
            0,
            clientFinal.lastIndexOf(",p="),
          );
          const proof = Buffer.from(
            clientFinal.slice(clientFinal.lastIndexOf(",p=") + 3),
            "base64",
          );
          const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
          const clientKey = hmac(salted, "Client Key");
          const signature = hmac(
            createHash("sha256").update(clientKey).digest(),
            authMessage,
          );
          const expected = Buffer.from(
            clientKey.map((byte, index) => byte ^ signature[index]!),
          );
          if (
            !expected.equals(proof) ||
            startup.at(-1)?.user !== options.user ||
            startup.at(-1)?.database !== options.database
          ) {
            stream.write(
              errorResponse(
                `password authentication failed for user "${startup.at(-1)?.user}"`,
                "28P01",
              ),
            );
            stream.end();
            return;
          }
          const serverSignature = options.forgeServerSignature
            ? randomBytes(32)
            : hmac(hmac(salted, "Server Key"), authMessage);
          phase = "ready";
          stream.write(
            Buffer.concat([
              auth(12, Buffer.from(`v=${serverSignature.toString("base64")}`)),
              auth(0),
              message("Z", Buffer.from("I")),
            ]),
          );
        } else if (phase === "ready" && type === "Q") {
          const sql = body.subarray(0, body.length - 1).toString();
          queries.push(sql);
          if (options.stallQueries) return;
          const result =
            options.onQuery?.(sql) ??
            (/^select 1$/i.test(sql.trim())
              ? { columns: ["?column?"], rows: [["1"]], tag: "SELECT 1" }
              : { tag: "OK" });
          stream.write(
            Buffer.concat([
              ...resultMessages(result),
              message("Z", Buffer.from("I")),
            ]),
          );
        } else if (type === "X") {
          stream.end();
          return;
        }
      }
    };
    stream.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      drain();
    });
  };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    serve(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fake postgres failed to listen");
  return {
    port: address.port,
    queries,
    startup,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
