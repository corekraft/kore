const MAX_LENGTH = 32;
const ORDINALS = new Set([
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
]);

const EXAMPLE = "name it for its subject, such as image-trust-reader";

function isPlaceholderSegment(segment: string): boolean {
  return (
    /^[a-z]$/.test(segment) ||
    /^\d{1,2}$/.test(segment) ||
    /^step\d+$/.test(segment) ||
    /^\d+(st|nd|rd|th)$/.test(segment) ||
    ORDINALS.has(segment)
  );
}

/** Returns why a session name is unusable and how to fix it, or undefined when it is fine. */
export function sessionNameError(name: string): string | undefined {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return `Session name "${name}" must use only lowercase letters, digits, "-" and "_"; ${EXAMPLE}.`;
  }
  if (name.length > MAX_LENGTH) {
    return `Session name "${name}" is ${name.length} characters, but Herdr allows at most ${MAX_LENGTH}; shorten it, for example by dropping the role suffix.`;
  }
  if (name.split(/[-_]/).some(isPlaceholderSegment)) {
    return `Session name "${name}" uses a letter, ordinal or step number; ${EXAMPLE}.`;
  }
  return undefined;
}
