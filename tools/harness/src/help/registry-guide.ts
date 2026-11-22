import type { Command } from "../runtime/index.js";
import type { DomainGuide, RootGuide } from "./guide.js";
import type { Lookup } from "./registry-command.js";

export interface GuideInput {
  domains: Record<string, Record<string, Command>>;
  guides: Record<string, DomainGuide>;
  root: RootGuide;
}

const isOneLine = (text: string): boolean =>
  text.trim() !== "" && !/[\r\n]/.test(text);

function guideLineProblems(
  domain: string,
  guide: DomainGuide,
  lookup: Lookup,
): string[] {
  const problems: string[] = [];
  if (!isOneLine(guide.purpose)) {
    problems.push(`${domain}: guide purpose is empty or more than one line`);
  }
  if (!isOneLine(guide.flow)) {
    problems.push(`${domain}: guide flow is empty or more than one line`);
  }
  for (const ref of guide.seeAlso ?? []) {
    if (lookup(ref) === undefined) {
      problems.push(`${domain}: guide see also "${ref}" is not a command`);
    }
  }
  return problems;
}

function domainProblems(input: GuideInput, lookup: Lookup): string[] {
  const missing = Object.keys(input.domains)
    .filter((domain) => !Object.hasOwn(input.guides, domain))
    .map((domain) => `${domain}: domain has no guide in help/domain-guides.ts`);
  const unknown = Object.keys(input.guides)
    .filter((domain) => !Object.hasOwn(input.domains, domain))
    .map(
      (domain) => `guide for "${domain}": the command table has no such domain`,
    );
  const each = Object.entries(input.guides).flatMap(([domain, guide]) =>
    guideLineProblems(domain, guide, lookup),
  );
  return [...missing, ...unknown, ...each];
}

function flowProblems(root: RootGuide, lookup: Lookup): string[] {
  return root.flows.flatMap((flow) => {
    if (flow.steps.length === 0) {
      return [`root flow "${flow.name}" has no steps`];
    }
    return flow.steps
      .filter((step) => lookup(step) === undefined)
      .map(
        (step) => `root flow "${flow.name}" step "${step}" is not a command`,
      );
  });
}

function rootProblems(root: RootGuide, lookup: Lookup): string[] {
  const text = [
    ...(isOneLine(root.what)
      ? []
      : ["root: what is empty or more than one line"]),
    ...(isOneLine(root.deeper)
      ? []
      : ["root: deeper is empty or more than one line"]),
  ];
  return [...text, ...flowProblems(root, lookup)];
}

/** The guides: a guide per domain, one-line purposes and flows, related commands that resolve, and root flow steps that are commands. */
export function guideProblems(input: GuideInput, lookup: Lookup): string[] {
  return [
    ...domainProblems(input, lookup),
    ...rootProblems(input.root, lookup),
  ];
}
