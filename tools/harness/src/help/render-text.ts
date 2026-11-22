import type {
  CommandView,
  DomainView,
  FlagView,
  HelpView,
  RootView,
} from "./view.js";

const INDENT = "  ";

/** Two columns: the left padded to its longest entry, then two spaces, then the right. */
function columns(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(0, ...rows.map(([left]) => left.length));
  return rows.map(([left, right]) =>
    `${left.padEnd(width)}  ${right}`.trimEnd(),
  );
}

/** A fixed heading, then its non-blank lines indented; nothing at all when no line has text. */
function section(heading: string, lines: readonly string[]): string[] {
  const kept = lines.filter((line) => line.trim() !== "");
  if (kept.length === 0) {
    return [];
  }
  return [heading + ":", ...kept.map((line) => INDENT + line), ""];
}

function flagLabel(flag: FlagView): string {
  return flag.kind === "boolean" ? `--${flag.name}` : `--${flag.name} <value>`;
}

function rootLines(view: RootView): string[] {
  return [
    view.what,
    "",
    ...section(
      "Domains",
      columns(view.domains.map((domain) => [domain.name, domain.purpose])),
    ),
    ...section(
      "Common flows",
      view.flows.flatMap((flow) => [
        `${flow.name}:`,
        ...flow.steps.map((step) => `${INDENT}harness ${step}`),
      ]),
    ),
    ...section("Going deeper", [view.deeper]),
  ];
}

function domainLines(view: DomainView): string[] {
  return [
    view.purpose,
    "",
    ...section("Usual flow", [view.flow]),
    ...section(
      "Commands",
      columns(
        view.commands.map((command) => [
          `harness ${command.path}`,
          command.summary,
        ]),
      ),
    ),
    ...section(
      "See also",
      view.seeAlso.map((ref) => `harness ${ref}`),
    ),
  ];
}

function commandLines(view: CommandView): string[] {
  return [
    `harness ${view.path}: ${view.summary}`,
    "",
    ...(view.purpose.trim() === "" ? [] : [view.purpose, ""]),
    ...section("Usage", [view.usage]),
    ...section("When to use", [view.when]),
    ...section("When not to use", [view.whenNot]),
    ...section(
      "Flags",
      columns(view.flags.map((flag) => [flagLabel(flag), flag.description])),
    ),
    ...section(
      "Operand",
      columns(
        view.operand === undefined
          ? []
          : [[`<${view.operand.name}>`, view.operand.description]],
      ),
    ),
    ...section(
      "Examples",
      view.examples.flatMap((example) => [
        example.command,
        INDENT + example.shows,
      ]),
    ),
    ...section(
      "Exit codes",
      columns(view.exits.map((exit) => [String(exit.code), exit.meaning])),
    ),
    ...section("Effects", [`${view.effects.kind}: ${view.effects.detail}`]),
    ...section(
      "See also",
      view.seeAlso.map((ref) => `harness ${ref}`),
    ),
  ];
}

function finish(lines: readonly string[]): string {
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The prose help at one level: fixed headings, plain string building, exit-code free. */
export function renderText(view: HelpView): string {
  if (view.level === "root") {
    return finish(rootLines(view));
  }
  if (view.level === "domain") {
    return finish(domainLines(view));
  }
  return finish(commandLines(view));
}
