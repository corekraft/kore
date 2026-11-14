const UNITS: Record<string, number> = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};

/** Free memory as a share of total from macOS `memory_pressure -Q`; undefined when the report lacks it. */
export function parseMemoryPressure(text: string): number | undefined {
  const match = /memory free percentage:\s*(\d{1,3})%/.exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]) / 100;
}

/** Used swap in bytes from macOS `sysctl -n vm.swapusage`; undefined when absent. */
export function parseSwapUsage(text: string): number | undefined {
  const match = /used = (\d+(?:\.\d+)?)([KMGT])/.exec(text);
  const unit = match?.[2] === undefined ? undefined : UNITS[match[2]];
  return match?.[1] === undefined || unit === undefined
    ? undefined
    : Math.round(Number(match[1]) * unit);
}

/** Used swap in bytes from the Swap row of `free -b`; undefined when absent. */
export function parseFreeSwap(text: string): number | undefined {
  const match = /^Swap:\s+\d+\s+(\d+)/m.exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
