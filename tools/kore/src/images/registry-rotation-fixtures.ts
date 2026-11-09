import { createHash } from "node:crypto";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";

export const oldCredentials = {
  push: { username: "kore-push", password: "old-push-password" },
  read: { username: "kore-read", password: "old-read-password" },
};

const b64 = (text: string): string => Buffer.from(text).toString("base64");
const unb64 = (text: string): string =>
  Buffer.from(text, "base64").toString("utf8");

export const hashLine = (username: string, password: string): string =>
  `${username}:{SHA}${createHash("sha1").update(password).digest("base64")}`;

interface Item {
  kind: string;
  metadata: { name: string; namespace?: string };
  data?: Record<string, string>;
}

/**
 * An in-memory cluster for the registry rotation: the two registry Secrets,
 * the enrolled namespaces' pull Secrets, and the htpasswd file the proxy
 * serves. The proxy's view follows the htpasswd Secret only after `lag`
 * reads, like a kubelet syncing a mounted Secret.
 */
export class FakeRegistryCluster implements Runner {
  calls: { command: string; args: readonly string[]; options?: RunOptions }[] =
    [];
  credentials: Record<string, string> = {
    "push-username": b64(oldCredentials.push.username),
    "push-password": b64(oldCredentials.push.password),
    "read-username": b64(oldCredentials.read.username),
    "read-password": b64(oldCredentials.read.password),
  };
  htpasswd = `${hashLine("kore-push", oldCredentials.push.password)}\n${hashLine("kore-read", oldCredentials.read.password)}\n`;
  served = this.htpasswd;
  pull = new Map<string, { username: string; password: string }>();
  /** Reads of the proxy's file before it shows the latest htpasswd. */
  lag = 2;
  /** Never shows the new htpasswd when true. */
  stuck = false;
  /** Fails the nth pull-Secret apply (1-based) with the secret in the message. */
  failPullApply: number | undefined;
  violations: string[] = [];
  private pullApplies = 0;
  private pendingReads = 0;

  constructor(readonly namespaces: string[]) {
    for (const namespace of namespaces) {
      this.pull.set(namespace, { ...oldCredentials.read });
    }
  }

  get servedLines(): string[] {
    return this.served.split("\n").filter(Boolean);
  }

  private check(): void {
    for (const [namespace, credential] of this.pull) {
      const line = hashLine(credential.username, credential.password);
      if (!this.servedLines.includes(line)) {
        this.violations.push(`${namespace} lost signature access`);
      }
    }
  }

  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const result = this.handle(args, options);
    this.check();
    return { stdout: result, stderr: "", code: 0 };
  }

  private handle(args: readonly string[], options?: RunOptions): string {
    if (args.includes("exec")) {
      if (this.pendingReads > 0 && !this.stuck && --this.pendingReads === 0) {
        this.served = this.htpasswd;
      }
      return this.served;
    }
    if (args.includes("get") && args.includes("secret")) {
      const data = args.includes("oci-registry-auth")
        ? { htpasswd: b64(this.htpasswd) }
        : this.credentials;
      return JSON.stringify({ data });
    }
    if (args.includes("get") && args.includes("namespaces")) {
      return this.namespaces.join(" ");
    }
    if (args.includes("apply")) {
      const list = JSON.parse(options?.input ?? "{}") as { items: Item[] };
      for (const item of list.items) {
        this.apply(item, options?.input ?? "");
      }
    }
    return "";
  }

  private apply(item: Item, input: string): void {
    if (item.metadata.name === "oci-registry-credentials") {
      this.credentials = { ...item.data };
    } else if (item.metadata.name === "oci-registry-auth") {
      this.htpasswd = unb64(item.data?.["htpasswd"] ?? "");
      this.pendingReads = this.lag;
      if (this.lag === 0) {
        this.served = this.htpasswd;
      }
    } else if (item.metadata.name === "kore-registry-read") {
      this.pullApplies += 1;
      if (this.pullApplies === this.failPullApply) {
        throw new Error(`apply failed, stdin echoed: ${input}`);
      }
      const config = JSON.parse(
        unb64(item.data?.[".dockerconfigjson"] ?? ""),
      ) as { auths: Record<string, { username: string; password: string }> };
      const [auth] = Object.values(config.auths);
      this.pull.set(item.metadata.namespace ?? "", {
        username: auth?.username ?? "",
        password: auth?.password ?? "",
      });
    }
  }

  get currentRead(): { username: string; password: string } {
    return {
      username: unb64(this.credentials["read-username"] ?? ""),
      password: unb64(this.credentials["read-password"] ?? ""),
    };
  }

  get currentPush(): { username: string; password: string } {
    return {
      username: unb64(this.credentials["push-username"] ?? ""),
      password: unb64(this.credentials["push-password"] ?? ""),
    };
  }
}
