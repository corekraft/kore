import type { EventFilter, TerminalEvent } from "./port.js";

/**
 * Whether the fake keeps an event for a filter: the event is for the terminal asked for, and its terminal carries
 * every label asked for. labelsOf is the labels of the terminal in the fake's model, undefined once it is removed,
 * so a removed terminal carries no label.
 */
export function keeps(
  event: TerminalEvent,
  labelsOf: Readonly<Record<string, string>> | undefined,
  filter: EventFilter,
): boolean {
  const onTerminal =
    filter.terminal === undefined || filter.terminal === event.terminal;
  return (
    onTerminal &&
    Object.entries(filter.labels ?? {}).every(
      ([key, value]) => labelsOf?.[key] === value,
    )
  );
}
