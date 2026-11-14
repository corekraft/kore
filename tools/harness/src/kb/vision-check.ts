// The vision's Decisions list: each label must match the status of the ADRs it links.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { finding, type Finding } from "./markdown.js";

/** What the vision check needs from an ADR's frontmatter. */
export interface AdrState {
  status: string;
  supersededBy?: string | undefined;
}

/** An ADR's state by its four-digit number, or null when there is no such ADR. */
export type AdrLookup = (number: string) => AdrState | null;

export const VISION = "docs/vision.md";
const ITEM = /^(\d+)\.\s/;
const LABEL = /\*\*[^*]+\*\*\s*(Decided|Chosen, proposed)/;
const ADR_LINK = /decisions\/(\d{4})-/g;

interface Decision {
  number: string;
  line: number;
  text: string;
}

/** Checks each numbered item of vision.md's Decisions list against its linked ADRs. */
export class VisionCheck {
  constructor(private readonly adr: AdrLookup) {}

  check(text: string): Finding[] {
    return this.decisions(text).flatMap((decision) => this.judge(decision));
  }

  /** The numbered items under the Decisions heading, each with its continuation lines. */
  private decisions(text: string): Decision[] {
    const found: Decision[] = [];
    let inList = false;
    text.split("\n").forEach((raw, index) => {
      if (raw.startsWith("## ")) {
        inList = raw === "## Decisions";
        return;
      }
      const start = inList ? ITEM.exec(raw) : null;
      if (start) {
        found.push({ number: start[1] ?? "", line: index + 1, text: raw });
      } else if (inList && found.length && raw.startsWith(" ")) {
        const last = found[found.length - 1];
        if (last) {
          last.text += ` ${raw.trim()}`;
        }
      }
    });
    return found;
  }

  private judge({ number, line, text }: Decision): Finding[] {
    const label = LABEL.exec(text)?.[1];
    const linked = [...text.matchAll(ADR_LINK)].map((m) => m[1] ?? "");
    const states = linked.flatMap((adr) => {
      const state = this.adr(adr);
      return state ? [{ adr, state }] : [];
    });
    if (!label || !states.length) {
      return [];
    }
    const superseded = states.find((s) => s.state.status === "superseded");
    if (superseded) {
      return [
        finding(
          VISION,
          line,
          `Decision ${number} links ADR ${superseded.adr}, which is superseded`,
          `link ADR ${superseded.state.supersededBy ?? "its replacement"}, the ADR that supersedes it, and label the Decision by that ADR's status`,
        ),
      ];
    }
    const proposed = states
      .filter((s) => s.state.status === "proposed")
      .map((s) => s.adr);
    if (proposed.length && label === "Decided") {
      return [
        finding(
          VISION,
          line,
          `Decision ${number} says Decided but ADR ${proposed.join(", ")} is proposed`,
          `change its label to "Chosen, proposed (ADR ${proposed.join(", ")})"`,
        ),
      ];
    }
    if (!proposed.length && label !== "Decided") {
      return [
        finding(
          VISION,
          line,
          `Decision ${number} says Chosen, proposed but every linked ADR is accepted`,
          'change its label to "Decided"',
        ),
      ];
    }
    return [];
  }
}
