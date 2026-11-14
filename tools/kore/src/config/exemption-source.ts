// Docs: docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md (exemption by name)
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConstraintExemptions,
  ExemptionSource,
  ListedExemption,
} from "./exemption-check.js";

/** Runs a read, naming the path and the fix when it does not exist. */
async function reading<T>(path: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      throw new Error(
        `exemption check: ${path} does not exist; run kore from a full repository checkout`,
      );
    }
    throw error;
  }
}

/** The items of a one-line YAML flow list's body. */
function flowList(body: string | undefined): string[] {
  return (body ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Reads the exemption inputs from a repository checkout. */
export class FileExemptionSource implements ExemptionSource {
  constructor(private readonly root: string) {}

  async constraints(): Promise<ConstraintExemptions[]> {
    const dir = join(this.root, "infra/policies/gatekeeper/constraints");
    const names = (await reading(dir, () => readdir(dir)))
      .filter((f) => f.endsWith(".yaml"))
      .sort();
    return Promise.all(
      names.map(async (file) => {
        const text = await readFile(join(dir, file), "utf8");
        const list = /exemptNamespaces:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? "";
        return {
          kind: /^kind:\s*(\S+)/m.exec(text)?.[1] ?? "",
          name: /metadata:\s*\{\s*name:\s*([\w-]+)/.exec(text)?.[1] ?? "",
          exemptNamespaces: list
            .split(",")
            .map((ns) => ns.trim())
            .filter(Boolean),
        };
      }),
    );
  }

  async listed(): Promise<ListedExemption[]> {
    const path = join(this.root, "infra/catalog/gatekeeper-exemptions.yaml");
    const text = await reading(path, () => readFile(path, "utf8"));
    return (JSON.parse(text) as { exemptions: ListedExemption[] }).exemptions;
  }

  async adrStatus(adr: number): Promise<string | undefined> {
    const dir = join(this.root, "docs/decisions");
    const prefix = `${String(adr).padStart(4, "0")}-`;
    const file = (await reading(dir, () => readdir(dir))).find((f) =>
      f.startsWith(prefix),
    );
    if (!file) {
      return undefined;
    }
    const text = await readFile(join(dir, file), "utf8");
    return /^status:\s*(\S+)/m.exec(text)?.[1];
  }

  async applicationNamespaces(): Promise<string[]> {
    const dir = join(this.root, "apps");
    const entries = await reading(dir, () =>
      readdir(dir, { withFileTypes: true }),
    );
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  async staticPassNamespaces(): Promise<string[]> {
    const path = join(this.root, "infra/charts/image-policy/values.yaml");
    const text = await reading(path, () => readFile(path, "utf8"));
    return flowList(/^staticPassNamespaces:\s*\[([^\]]*)\]/m.exec(text)?.[1]);
  }

  async gateWriters(): Promise<string[]> {
    const path = join(
      this.root,
      "infra/charts/admission-gate/templates/rbac.yaml",
    );
    const text = await reading(path, () => readFile(path, "utf8"));
    return flowList(
      /resources:\s*\[koreapplicationadmission\]\s*resourceNames:\s*\[([^\]]*)\]/.exec(
        text,
      )?.[1],
    );
  }
}
