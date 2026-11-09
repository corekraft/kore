import { spawn as nodeSpawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface ForwardChild {
  stdout: Readable;
  stderr: Readable;
  kill(): boolean;
  once(event: "exit", listener: (code: number | null) => void): unknown;
}

export interface ForwardOptions {
  context: string;
  namespace: string;
  target: string;
  remotePort: number;
  spawn?: typeof nodeSpawn;
}

/**
 * Runs `use` against a short-lived kubectl port-forward on an ephemeral local
 * port, and always kills the forward. `afterSpawn` is a test seam.
 */
export async function withForward<T>(
  options: ForwardOptions,
  use: (port: number) => Promise<T>,
  afterSpawn?: () => void,
): Promise<T> {
  const child = (options.spawn ?? nodeSpawn)(
    "kubectl",
    [
      "--context",
      options.context,
      "--namespace",
      options.namespace,
      "port-forward",
      options.target,
      `:${options.remotePort}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  ) as unknown as ForwardChild;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let stderr = "";
      let stdout = "";
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `port-forward to ${options.target} did not bind within 15s ${stderr}`,
            ),
          ),
        15000,
      );
      const done = (action: () => void) => {
        clearTimeout(timer);
        action();
      };
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const match = /127\.0\.0\.1:(\d+) ->/.exec(stdout);
        if (match?.[1]) {
          done(() => resolve(Number(match[1])));
        }
      });
      child.once("exit", () =>
        done(() =>
          reject(
            new Error(
              `port-forward to ${options.target} exited before binding: ${stderr.trim()}`,
            ),
          ),
        ),
      );
      afterSpawn?.();
    });
    return await use(port);
  } finally {
    child.kill();
  }
}

type Sleep = (milliseconds: number) => Promise<void>;
const sleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const attempts = 5;

/** A forward that has not attached yet, or a reset, closes the socket. */
function isReset(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause
    ?.code;
  return (
    code === "UND_ERR_SOCKET" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    (error as { code?: string })?.code === "ECONNRESET"
  );
}

/**
 * kubectl prints "Forwarding from" before it has dialed the pod, so a bound
 * port does not prove the forward. Only an answered HTTP request does; any
 * status (the OTLP receiver answers GET with 405) counts.
 */
export async function waitForOtlp(
  port: number,
  fetchFn: typeof fetch = fetch,
  wait: Sleep = sleep,
): Promise<void> {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await fetchFn(`http://127.0.0.1:${port}/v1/traces`);
      return;
    } catch (error) {
      if (!isReset(error)) {
        throw error;
      }
    }
    await wait(1000);
  }
  throw new Error(
    `port-forward on 127.0.0.1:${port} did not answer an HTTP request within 15s; is the Collector's loopback OTLP receiver (otlp/loopback) running?`,
  );
}

/** POSTs one OTLP/HTTP JSON payload; the Service proxy cannot set the type. */
export async function postOtlp(
  port: number,
  signal: "traces" | "logs" | "metrics",
  payload: object,
  fetchFn: typeof fetch = fetch,
  wait: Sleep = sleep,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetchFn(`http://127.0.0.1:${port}/v1/${signal}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!isReset(error) || attempt >= attempts) {
        throw error;
      }
      await wait(500 * attempt);
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Collector rejected OTLP ${signal}: ${response.status} ${await response.text()}`,
      );
    }
    return;
  }
}
