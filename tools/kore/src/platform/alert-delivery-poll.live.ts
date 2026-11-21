// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Polls until the read returns a value or the deadline passes; undefined on timeout. */
export async function awaitValue<T>(
  read: () => Promise<T | undefined>,
  deadline: number,
  deps: Clock,
  pollSeconds: number,
): Promise<T | undefined> {
  for (;;) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    if (deps.now() >= deadline) {
      return undefined;
    }
    await deps.sleep(pollSeconds * 1000);
  }
}
