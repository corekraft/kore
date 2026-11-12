const FORMS = [
  /\bfrom\s*["']([^"']+)["']/g, // import/export ... from "x"
  /\bimport\s*["']([^"']+)["']/g, // side-effect import "x"
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
  /\b__require\s*\(\s*["']([^"']+)["']\s*\)/g, // esbuild's require shim
];

/** Every module specifier the code loads, by any static or literal-dynamic form. */
export function importSpecifiers(code: string): string[] {
  return FORMS.flatMap((form) =>
    [...code.matchAll(form)].map((m) => m[1] ?? ""),
  );
}

/** Dynamic loads whose specifier is not a literal cannot be checked, so they are findings too. */
export function hasNonLiteralLoad(code: string): boolean {
  return /\b(?:import|require|__require)\s*\(\s*[^"'\s)]/.test(code);
}
