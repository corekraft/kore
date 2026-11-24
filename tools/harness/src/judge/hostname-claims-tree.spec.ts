import { describe, expect, it, vi } from "vitest";
import { CATALOG_PATH, claimKind, fileAt } from "./hostname-claims-tree.js";

const REPO = "corekraft/kore";
const SHA = "main0000";

/** An Api fake that answers each `gh api` call from a table keyed by its endpoint. */
function apiOf(answers: Record<string, string | Error>) {
  return vi.fn(async (args: readonly string[]) => {
    const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
    const answer = answers[endpoint];
    if (answer === undefined) {
      throw new Error(`unexpected call ${endpoint}`);
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
}

describe("claimKind names the claim inputs of an environment and nothing else", () => {
  it("names the services, suborgs, overlays, reserved list and catalog", () => {
    expect(claimKind("infra/environments/local/services/login.json")).toBe(
      "service",
    );
    expect(claimKind("infra/environments/local/organizations/shop.json")).toBe(
      "organization",
    );
    expect(claimKind("infra/environments/vps/environment.yaml")).toBe(
      "overlay",
    );
    expect(claimKind("infra/catalog/reserved-hostnames.json")).toBe("reserved");
    expect(
      claimKind("infra/catalog/schemas/reserved-hostnames.schema.json"),
    ).toBe("reserved");
    expect(claimKind(CATALOG_PATH)).toBe("catalog");
  });

  it("leaves release files, nested files and other paths out of the claims", () => {
    expect(
      claimKind("infra/environments/local/services/login.release.json"),
    ).toBeUndefined();
    expect(
      claimKind("infra/environments/local/services/nested/login.json"),
    ).toBeUndefined();
    expect(
      claimKind("infra/environments/local/values/istio-cni.yaml"),
    ).toBeUndefined();
    expect(claimKind("infra/catalog/versions.yaml")).toBeUndefined();
    expect(claimKind("tools/harness/src/judge/precheck.ts")).toBeUndefined();
  });
});

describe("fileAt reads one file at a commit", () => {
  it("reads a file at a commit as its text", async () => {
    const api = apiOf({
      [`repos/${REPO}/contents/${CATALOG_PATH}?ref=${SHA}`]: "{}",
    });
    await expect(fileAt(api, REPO, CATALOG_PATH, SHA)).resolves.toBe("{}");
  });

  it("reads a file missing at a commit as undefined, so a new or removed claim is absent on one side", async () => {
    const path = "infra/environments/local/services/new.json";
    const api = apiOf({
      [`repos/${REPO}/contents/${path}?ref=${SHA}`]: new Error(
        "gh api failed: gh: Not Found (HTTP 404)",
      ),
    });
    await expect(fileAt(api, REPO, path, SHA)).resolves.toBeUndefined();
  });

  it("rethrows any failure other than a missing file", async () => {
    const api = apiOf({
      [`repos/${REPO}/contents/${CATALOG_PATH}?ref=${SHA}`]: new Error(
        "gh api failed: connection reset",
      ),
    });
    await expect(fileAt(api, REPO, CATALOG_PATH, SHA)).rejects.toThrow(
      "connection reset",
    );
  });
});
