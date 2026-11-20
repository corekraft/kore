import { request } from "node:https";

// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md

/** One HTTPS request the OTLP poster makes, verified against the local CA. */
export interface OtlpRequest {
  url: string;
  ca: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface OtlpResponse {
  status: number;
  body: string;
}

/** Sends one request; the default verifies the server against the CA and never skips verification. */
export type OtlpTransport = (request: OtlpRequest) => Promise<OtlpResponse>;

export interface OtlpNameOptions {
  /** The OTLP name's base URL, https://otlp.<organizationId>.<domain>. */
  url: string;
  /** The local CA's public certificate (PEM), the trust the Gateway's certificate chains to. */
  ca: string;
  signal: "traces" | "logs" | "metrics";
  payload: object;
  transport?: OtlpTransport;
}

/** The default transport: node:https with the CA, so certificate verification is never disabled. */
function httpsTransport(req: OtlpRequest): Promise<OtlpResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      req.url,
      {
        method: req.method,
        headers: {
          ...req.headers,
          "Content-Length": Buffer.byteLength(req.body),
        },
        ca: req.ca,
        rejectUnauthorized: true,
        timeout: 30000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.once("timeout", () =>
      outgoing.destroy(new Error("OTLP request timed out")),
    );
    outgoing.once("error", reject);
    outgoing.end(req.body);
  });
}

/**
 * POSTs one OTLP/HTTP JSON payload to the OTLP name through the shared Gateway
 * (ADR 0140). A connection that fails names the route to check, and a non-2xx
 * answer names its status and body, so a failure never reads as a timeout.
 */
export async function postOtlpToName(options: OtlpNameOptions): Promise<void> {
  const { url, ca, signal, payload, transport = httpsTransport } = options;
  let response: OtlpResponse;
  try {
    response = await transport({
      url: `${url}/v1/${signal}`,
      ca,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not reach ${url} for OTLP ${signal} (${cause}); check that HTTPRoute otlp in observability is Accepted by the shared Gateway's https-platform listener, and that the local CA is trusted`,
    );
  }
  if (response.status < 200 || response.status > 299) {
    throw new Error(
      `Collector rejected OTLP ${signal}: ${response.status} ${response.body}`,
    );
  }
}
