// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { expectTypeOf, test } from "vitest";
import type { ComponentKind, Phase, Repository } from "./types.js";

// types.ts holds only types, so it has no behaviour to run. Its spec pins the
// closed sets the validators rely on; the typecheck gate fails when one drifts.

test("a component's release phase is one of the five phases the order is built from", () => {
  expectTypeOf<Phase>().toEqualTypeOf<
    "bootstrap" | "core" | "observability" | "configuration" | "enforcement"
  >();
});

test("a component is a helm chart, a local chart or a manifest, and nothing else", () => {
  expectTypeOf<ComponentKind>().toEqualTypeOf<
    "helm" | "local-chart" | "manifest"
  >();
});

test("a repository is read from a root directory, with its environment at a fixed field", () => {
  expectTypeOf<Repository["root"]>().toEqualTypeOf<string>();
  expectTypeOf<Repository["environment"]["registry"]>().toEqualTypeOf<{
    address: string;
  }>();
});
