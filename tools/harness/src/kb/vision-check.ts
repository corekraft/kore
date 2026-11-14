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
export const VISION_HTML = "docs/vision.html";
const ITEM = /^(\d+)\.\s/;
const LABEL = /\*\*[^*]+\*\*\s*(Decided|Chosen, proposed)/;
const ADR_LINK = /decisions\/(\d{4})-/g;
const FIRST_LINK = /decisions\/(\d{4})-/;
const LABELLED_ADR = /ADR (\d{4})\)/;
const MD_DATE = /^last-verified:\s*(\S+)\s*$/m;
const HTML_DATE = /Last verified (\d{4}-\d{2}-\d{2})/;
const BADGE = />\s*(Decided|Chosen, proposed)\s*·\s*ADR (\d{4})\s*</;

interface Decision {
  number: string;
  line: number;
  text: string;
}

/** A Decision's badge: its status label and the ADR it cites. */
interface Badge {
  label: string;
  adr: string;
  line: number;
  number: number;
}

const show = (b: Badge) => `${b.label} · ADR ${b.adr}`;

/** The badges in `list` that `other` does not also hold, matched one for one. */
function without(list: Badge[], other: Badge[]): Badge[] {
  const left = other.map(show);
  return list.filter((b) => {
    const found = left.indexOf(show(b));
    if (found >= 0) {
      left.splice(found, 1);
    }
    return found < 0;
  });
}

/** Checks vision.md's Decisions against their ADRs, and vision.html's badges and date against vision.md. */
export class VisionCheck {
  constructor(private readonly adr: AdrLookup) {}

  check(text: string, html?: string | null): Finding[] {
    const found = this.decisions(text).flatMap((d) => this.judge(d));
    return html === undefined || html === null
      ? found
      : [...found, ...this.badges(text, html), ...this.date(text, html)];
  }

  private date(text: string, html: string): Finding[] {
    const want = MD_DATE.exec(text)?.[1];
    const lines = html.split("\n");
    const at = lines.findIndex((l) => HTML_DATE.test(l));
    const have = HTML_DATE.exec(lines[at] ?? "")?.[1];
    return want && have && want !== have
      ? [
          finding(
            VISION_HTML,
            at + 1,
            `vision.html says Last verified ${have} but vision.md says ${want}`,
            `change the header date to ${want}`,
          ),
        ]
      : [];
  }

  private badges(text: string, html: string): Finding[] {
    const want = this.decisions(text).flatMap((d): Badge[] => {
      const label = LABEL.exec(d.text)?.[1];
      const adr = (LABELLED_ADR.exec(d.text) ?? FIRST_LINK.exec(d.text))?.[1];
      return label && adr
        ? [{ label, adr, line: d.line, number: Number(d.number) }]
        : [];
    });
    const lines = html.split("\n");
    const start = lines.findIndex((l) => l.includes('<ol class="questions">'));
    const have: Badge[] = [];
    for (let i = start + 1; start >= 0 && i < lines.length; i++) {
      const row = lines[i] ?? "";
      if (row.includes("</ol>")) {
        break;
      }
      const m = BADGE.exec(row);
      if (m) {
        have.push({
          label: m[1] ?? "",
          adr: m[2] ?? "",
          line: i + 1,
          number: have.length + 1,
        });
      }
    }
    return want.length === have.length
      ? this.compare(want, have)
      : this.unmatched(want, have, start + 1);
  }

  private compare(want: Badge[], have: Badge[]): Finding[] {
    return want.flatMap((w, i): Finding[] => {
      const h = have[i];
      if (!h || show(h) === show(w)) {
        return [];
      }
      const fix = `change the badge to "${show(w)}"`;
      if (h.adr === w.adr) {
        return [
          finding(
            VISION_HTML,
            h.line,
            `Decision ${w.number} badge says "${h.label}" but vision.md says "${w.label}"`,
            fix,
          ),
        ];
      }
      if (h.label === w.label && !want.some((o) => show(o) === show(h))) {
        return [
          finding(
            VISION_HTML,
            h.line,
            `Decision ${w.number} badge says ADR ${h.adr} but vision.md says ADR ${w.adr}`,
            fix,
          ),
        ];
      }
      return [
        finding(
          VISION_HTML,
          h.line,
          `Decision ${w.number} is out of order in vision.html`,
          `put the badge "${show(w)}" here`,
        ),
      ];
    });
  }

  private unmatched(want: Badge[], have: Badge[], at: number): Finding[] {
    return [
      ...without(want, have).map((w) =>
        finding(
          VISION_HTML,
          at || 1,
          `Decision ${w.number} is missing from vision.html`,
          `add the badge "${show(w)}" for it`,
        ),
      ),
      ...without(have, want).map((h) =>
        finding(
          VISION_HTML,
          h.line,
          `vision.html has the badge "${show(h)}", which vision.md does not list`,
          "remove it, or add the Decision to vision.md",
        ),
      ),
    ];
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
