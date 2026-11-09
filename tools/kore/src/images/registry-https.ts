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
