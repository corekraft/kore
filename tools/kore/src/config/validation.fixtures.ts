import { loadRepository, validateRepository } from "./config.js";
import type { Repository } from "./types.js";

export const sound = {
  phase: "core" as const,
  namespace: "ns",
  kind: "helm" as const,
  chart: "chart",
  version: "local",
  ownsCRDs: [] as string[],
  dependencies: [] as string[],
  timeout: "1m",
  readiness: ["deployment/sound"],
};

export async function validationMessage(
  mutate: (base: Awaited<ReturnType<typeof loadRepository>>) => unknown,
  load: () => Promise<Repository> = async () => await loadRepository("local"),
): Promise<string> {
  const base = await load();
  try {
    await validateRepository(
      mutate({
        ...base,
        seeds: { seeds: [] },
        approved: { images: [] },
      }) as typeof base,
    );
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}
