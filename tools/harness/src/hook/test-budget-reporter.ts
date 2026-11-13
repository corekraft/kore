// The vitest reporter behind the test-budget hook: it writes, per spec file,
// the time from environment setup through import and collection to the last
// test, and the run's time from reporter start (so startup and global setup
// count). The built-in json reporter times only test bodies (ADR 0098).
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import type { Reporter } from "vitest/node";

export interface TestCaseLike {
  fullName: string;
  diagnostic(): { duration: number } | undefined;
}

export interface ModuleLike {
  moduleId: string;
  diagnostic(): {
    environmentSetupDuration: number;
    prepareDuration: number;
    setupDuration: number;
    collectDuration: number;
    duration: number;
  };
  children: { allTests(): Iterable<TestCaseLike> };
}

export interface BudgetReporterOptions {
  outputFile: string;
  write: (path: string, text: string) => void;
  now: () => number;
}

/** The report the hook reads: times in ms. */
export interface BudgetReport {
  runMs: number;
  files: { name: string; ms: number; tests: { name: string; ms: number }[] }[];
}

export class BudgetReporter implements Reporter {
  private started = 0;

  constructor(private readonly options: BudgetReporterOptions) {}

  onInit(): void {
    this.started = this.options.now();
  }

  onTestRunEnd(modules: ReadonlyArray<ModuleLike>): void {
    const report: BudgetReport = {
      runMs: this.options.now() - this.started,
      files: modules.map((module) => {
        const d = module.diagnostic();
        return {
          name: module.moduleId,
          ms:
            d.environmentSetupDuration +
            d.prepareDuration +
            d.setupDuration +
            d.collectDuration +
            d.duration,
          tests: [...module.children.allTests()].map((t) => ({
            name: t.fullName,
            ms: t.diagnostic()?.duration ?? 0,
          })),
        };
      }),
    };
    this.options.write(this.options.outputFile, JSON.stringify(report));
  }
}
