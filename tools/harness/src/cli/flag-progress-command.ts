import { IdeaRepository } from "../idea/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import {
  FlagError,
  progressOf,
  readManifest,
  readOverlay,
  recordedProofs,
  renderProgress,
} from "../flag/index.js";
import { guarded, releaseLock, root, text } from "./flag-command-support.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

/** The help record for `flag progress`: the read-only report of an environment's flags and the next one to prove. */
const progressHelp: CommandHelp = {
  purpose:
    "Reports, for one environment, every flag that applies to it: whether it is on, which proof it rests on (a live run, an owner waiver, or none), which requirements it still waits on, and the next flag to prove. Environment flags are reported apart from feature flags and never counted as features (ADR 0148). The flags the manifest marks not applicable or pending, and a harness flag outside local, are excluded with the reason. In a production environment an owner waiver does not count (ADR 0147).",
  when: "To see how far an environment is from every applicable flag on, or which flag to prove next, before a live run.",
  whenNot:
    "To turn a flag on: use flag activate, which refuses without proof. To fail when a flag on in an overlay has no proof: use flag audit.",
  flags: {
    environment:
      "The environment to report, such as vps. Required: the command never picks one for you.",
    "chart-lock":
      "The release's platform-charts.lock.json: a main-lock live run counts only when its charts equal this lock, as activation requires. A relative path is read from the repository root.",
  },
  examples: [
    {
      command: "harness flag progress --environment vps",
      shows:
        "the text report: each environment flag and feature flag with its state and proof, the excluded flags with their reasons, the counts, and the next flag to prove",
    },
    {
      command: "harness flag progress --environment vps --json",
      shows: "the same report as one JSON object on stdout",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the report is printed; flags still off are reported, not failed",
    },
    {
      code: 1,
      meaning:
        "refused and nothing is reported: a missing --environment, an environment with no overlay, a manifest that cannot be read or checked, a chart lock that cannot be read, or an overlay whose production mark is not true or false",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the environment overlay, the flag manifest, the chart lock named by --chart-lock and the idea records; writes nothing and opens no ledger",
  },
  seeAlso: ["flag audit", "flag activate"],
};

/** Reports an environment's flags, as text or as one JSON object, and changes nothing. */
async function progressFlags(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const environment = text(context.options, "environment");
  if (environment === undefined) {
    throw new FlagError(
      "Missing --environment; run `harness flag progress --environment <env>`.",
    );
  }
  const base = await root(context);
  const overlay = await readOverlay(deps.fs, base, environment);
  const production = overlay.production === true;
  const manifest = await readManifest(deps.fs, base);
  const proofs = await recordedProofs(
    new IdeaRepository(deps.fs, deps.clock, base),
    environment,
    await releaseLock(context, base),
    production,
  );
  const report = progressOf({
    environment,
    path: overlay.path,
    production,
    manifest,
    features: overlay.features,
    proofs,
  });
  deps.stdout(json ? `${JSON.stringify(report)}\n` : renderProgress(report));
  return 0;
}

export const progress: Command = {
  help: progressHelp,
  summary:
    "report an environment's applicable flags, their proof and the next flag to prove, read-only",
  options: { environment: "string", "chart-lock": "string" },
  run: (context) => guarded(context, () => progressFlags(context)),
};
