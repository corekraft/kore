import { IdeaRepository, outcomeSection } from "../idea/index.js";

export interface Proof {
  idea: string;
  path: string;
}

/** The tool's field block: the lines under `## Outcome` up to the first blank line. The summary after it is free text. */
function fieldBlock(section: string): string[] {
  const body = section.split("\n").slice(1);
  const start = body.findIndex((line) => line.trim() !== "");
  const rest = start === -1 ? [] : body.slice(start);
  const end = rest.findIndex((line) => line.trim() === "");
  return end === -1 ? rest : rest.slice(0, end);
}

function lines(section: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of fieldBlock(section)) {
    const match = /^- ([A-Za-z]+): (.*)$/.exec(line);
    if (match?.[1] !== undefined && !found.has(match[1])) {
      found.set(match[1], (match[2] ?? "").trim());
    }
  }
  return found;
}

/**
 * The idea whose recorded outcome is confirmed, live-run verification of this
 * flag in this environment. Only the outcome tool writes that block, and it
 * rejects summary lines shaped like a field, so a match is proof on record
 * (ADR 0077).
 */
export async function findProof(
  repo: IdeaRepository,
  flag: string,
  environment: string,
): Promise<Proof | undefined> {
  for (const record of await repo.list()) {
    const section = outcomeSection(await repo.source(record));
    if (section === undefined) {
      continue;
    }
    const fields = lines(section);
    if (
      fields.get("Result") === "confirmed" &&
      fields.get("Kind") === "verification" &&
      fields.get("Source") === "live-run" &&
      fields.get("Flag") === flag &&
      fields.get("Environment") === environment
    ) {
      return { idea: record.number, path: record.path };
    }
  }
  return undefined;
}
