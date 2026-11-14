import type { Stats } from "node:fs";
import type { FileHandle, glob } from "node:fs/promises";
import type { Mock } from "vitest";
import { vi } from "vitest";

/** An error as node's fs rejects it: an Error carrying its `code`. */
export function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** The stat result the file system reads: a modification time and whether it is a directory. */
export function fakeStats(
  fields: { mtimeMs?: number; directory?: boolean } = {},
): Stats {
  return {
    mtimeMs: fields.mtimeMs ?? 0,
    isDirectory: () => fields.directory ?? false,
  } as unknown as Stats;
}

/** A file handle over `content`: each read copies the bytes its position and length ask for. */
export interface FakeHandle {
  read: Mock<
    (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => Promise<{ bytesRead: number }>
  >;
  stat: Mock<() => Promise<{ size: number }>>;
  close: Mock<() => Promise<void>>;
}

export function fakeHandle(content: string): FakeHandle {
  const bytes = Buffer.from(content);
  return {
    read: vi.fn((buffer, _offset, length, position) => {
      const copied = bytes.subarray(position, position + length);
      copied.copy(buffer, 0);
      return Promise.resolve({ bytesRead: copied.length });
    }),
    stat: vi.fn(() => Promise.resolve({ size: bytes.length })),
    close: vi.fn(() => Promise.resolve()),
  };
}

/** The handle as the open call returns it. */
export function asFileHandle(handle: FakeHandle): FileHandle {
  return handle as unknown as FileHandle;
}

/** A walk as the glob call returns it: the paths the generator yields, typed as the real walk. */
export function asGlob(paths: AsyncIterable<string>): ReturnType<typeof glob> {
  return paths as unknown as ReturnType<typeof glob>;
}
