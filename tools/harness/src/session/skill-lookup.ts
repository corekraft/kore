/** One area of the repository and the skill that covers changing it. */
interface SkillArea {
  skill: string;
  /** Exact files or directory prefixes (ending in a slash). */
  paths: readonly string[];
}

/** The path-to-skill table; it lives here, not in the writer definition. */
const AREAS: readonly SkillArea[] = [
  { skill: "add-command", paths: ["tools/kore/src/cli/"] },
  { skill: "add-policy", paths: ["infra/policies/"] },
  {
    skill: "pin-upgrade",
    paths: [
      ".mise.toml",
      "infra/catalog/versions.yaml",
      "infra/catalog/components.yaml",
      "infra/charts/",
    ],
  },
  { skill: "write-adr", paths: ["docs/decisions/"] },
];

function covers(area: SkillArea, path: string): boolean {
  return area.paths.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );
}

/** The skills that cover the given paths, once each, in table order. */
export function skillsForPaths(paths: readonly string[]): string[] {
  return AREAS.filter((area) => paths.some((path) => covers(area, path))).map(
    (area) => area.skill,
  );
}

/** The path-like words in a text, without surrounding punctuation. */
export function extractPaths(text: string): string[] {
  return (text.match(/[\w.][\w./-]*/g) ?? [])
    .map((word) => word.replace(/[.]+$/, ""))
    .filter((word) => word.includes("/") || word.startsWith("."));
}
