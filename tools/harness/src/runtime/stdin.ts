/** A readable stream of bytes; `isTTY` is set when a person, not a pipe, is on the other end. */
export type StdinStream = AsyncIterable<Uint8Array> & { isTTY?: boolean };

/** All of stdin as text; empty without reading when stdin is a terminal, which would block forever. */
export async function readStdin(stream: StdinStream): Promise<string> {
  if (stream.isTTY === true) {
    return "";
  }
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts).toString("utf8");
}
