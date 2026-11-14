// Docs: docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md (exemption by name)
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConstraintExemptions,
  ExemptionSource,
  ListedExemption,
} from "./exemption-check.js";

/** Reads the exemption inputs from a repository checkout. */
export class FileExemptionSource implements ExemptionSource {
  constructor(private readonly root: string) {}

  async constraints(): Promise<ConstraintExemptions[]> {
    const dir = join(this.root, "infra/policies/gatekeeper/constraints");
    const names = (await readdir(dir))
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
    const text = await readFile(
      join(this.root, "infra/catalog/gatekeeper-exemptions.yaml"),
      "utf8",
    );
    return (JSON.parse(text) as { exemptions: ListedExemption[] }).exemptions;
  }

  async adrStatus(adr: number): Promise<string | undefined> {
    const dir = join(this.root, "docs/decisions");
    const prefix = `${String(adr).padStart(4, "0")}-`;
    const file = (await readdir(dir)).find((f) => f.startsWith(prefix));
    if (!file) {
      return undefined;
    }
    const text = await readFile(join(dir, file), "utf8");
    return /^status:\s*(\S+)/m.exec(text)?.[1];
  }

  async applicationNamespaces(): Promise<string[]> {
    const entries = await readdir(join(this.root, "apps"), {
      withFileTypes: true,
    });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }
}
