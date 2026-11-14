import { request } from "node:https";

// Docs: docs/decisions/0058-registry-transport-tls.md

export interface RegistryHead {
  status: number;
  digest: string;
}

/**
 * HEAD over HTTPS, verifying the server against the internal registry CA. Node's
 * global fetch cannot take a per-request CA without a dependency, so this
 * uses the standard library; certificate verification is never disabled.
 */
export async function registryHead(
  url: string,
  headers: Record<string, string>,
  ca: string,
): Promise<RegistryHead> {
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "HEAD", headers, ca, rejectUnauthorized: true, timeout: 30000 },
      (response) => {
        response.resume();
        const digest = response.headers["docker-content-digest"];
        resolve({
          status: response.statusCode ?? 0,
          digest: Array.isArray(digest) ? (digest[0] ?? "") : (digest ?? ""),
        });
      },
    );
    req.once("timeout", () =>
      req.destroy(new Error("registry request timed out")),
    );
    req.once("error", reject);
    req.end();
  });
}

export interface RegistryResponse {
  status: number;
  /** Lowercase header names to their first value. */
  headers: Record<string, string>;
  body: string;
}

/** Any method over the same verified HTTPS transport, with the body read. */
export async function registryRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  ca: string,
): Promise<RegistryResponse> {
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      { method, headers, ca, rejectUnauthorized: true, timeout: 30000 },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).flatMap(([name, value]) => {
                const first = Array.isArray(value) ? value[0] : value;
                return first === undefined ? [] : [[name, first]];
              }),
            ),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.once("error", reject);
      },
    );
    req.once("timeout", () =>
      req.destroy(new Error("registry request timed out")),
    );
    req.once("error", reject);
    req.end();
  });
}
