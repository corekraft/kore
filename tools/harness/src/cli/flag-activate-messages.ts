/** Why no proof counts and what to record. An owner waiver is offered only where one is accepted: a production environment never takes one (ADR 0147). */
export function noOutcomeMessage(
  flag: string,
  environment: string,
  overlay: { path: string; production?: boolean },
): string {
  const record = `harness outcome record --idea <number> --kind verification --source live-run --result confirmed --flag ${flag} --environment ${environment} --evidence <run> --summary <text>`;
  if (overlay.production) {
    return `No verification outcome records a live run of ${flag} in ${environment}, so ${overlay.path} is unchanged. Prove it live, then run \`${record}\`.`;
  }
  return `No verification outcome records a live run or an owner waiver of ${flag} in ${environment}, so ${overlay.path} is unchanged. Prove it live, then run \`${record}\`. Or, when the owner has waived the live run in a GitHub comment, use \`--source owner-waiver --evidence <comment url>\`.`;
}
