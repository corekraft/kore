// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { beforeEach, expect, test, vi } from "vitest";
import { applyCloudflareTokens, syncLocalSecrets } from "../security/index.js";
import { secretsCommand } from "./commands-local.js";
import { fakeContext, fakeRepository, sharedRunner } from "./cli-support.js";
import { print } from "./output.js";

vi.mock("../images/index.js");
vi.mock("../local/index.js");
vi.mock("../platform/index.js");
vi.mock("../security/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./local-chart-lock.js");
vi.mock("./output.js");

const repository = fakeRepository({ name: "vps", provider: "managed" });

beforeEach(() => {
  vi.resetAllMocks();
});

test("secrets tokens applies the token Secrets of the consumers that are on, as a mutation, and reports each Secret by consumer and namespace", async () => {
  vi.mocked(applyCloudflareTokens).mockResolvedValue([
    { consumer: "external-dns", namespace: "kore-external-dns" },
  ]);
  const context = fakeContext({
    command: "secrets",
    action: "tokens",
    repository,
    json: true,
  });

  expect(await secretsCommand(context)).toBe(0);

  expect(context.mutate).toHaveBeenCalledWith(
    "secrets tokens",
    expect.any(Function),
  );
  expect(applyCloudflareTokens).toHaveBeenCalledWith(repository, sharedRunner);
  expect(syncLocalSecrets).not.toHaveBeenCalled();
  expect(print).toHaveBeenCalledWith(
    {
      status: "applied",
      secrets: [{ consumer: "external-dns", namespace: "kore-external-dns" }],
    },
    true,
  );
});

test("secrets tokens with every consumer off reports that nothing was applied", async () => {
  vi.mocked(applyCloudflareTokens).mockResolvedValue([]);
  const context = fakeContext({
    command: "secrets",
    action: "tokens",
    repository,
  });

  expect(await secretsCommand(context)).toBe(0);

  expect(print).toHaveBeenCalledWith(
    { status: "nothing-to-apply", secrets: [] },
    false,
  );
});
