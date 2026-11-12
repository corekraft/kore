export interface Clock {
  now(): Date;
  /** Resolves after `ms` milliseconds; fakes advance their own time instead. */
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The calendar day of `date` in the local time zone, as YYYY-MM-DD. */
export function localDate(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
