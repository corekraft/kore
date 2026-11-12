import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { localDown } from "./local.js";

test("local down reaches the platform stop and destroy for a k3d environment", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "k3d" as const },
  };
  const calls: string[] = [];
  const dependencies = {
    platformStop: async () => {
      calls.push("stop");
    },
    platformDestroy: async (
      _repository: unknown,
      _runner: unknown,
      options: { yes: boolean; purgeData: boolean },
    ) => {
      calls.push(`destroy:${options.yes}:${options.purgeData}`);
    },
  };
  await localDown(
    repository,
    {} as never,
    { prune: false, purgeData: false },
    dependencies,
  );
  await localDown(
    repository,
    {} as never,
    { prune: true, purgeData: false },
    dependencies,
  );
  expect(calls).toEqual(["stop", "destroy:true:false"]);
});
