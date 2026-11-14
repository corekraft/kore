// Transcript event builders for the retro session specs: data only, one event
// per call, with the line number the scan reports.

import type { Transcript, TranscriptEvent } from "./retro-transcript.js";

export const session = (events: TranscriptEvent[]): Transcript => ({
  id: "s",
  events,
  skipped: 0,
});

export const toolUse = (line: number, id: string): TranscriptEvent => ({
  line,
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name: "Bash", input: {} }] },
});

export const toolError = (
  line: number,
  id: string,
  text: string,
): TranscriptEvent => ({
  line,
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, is_error: true, content: text },
    ],
  },
});

export const bashUse = (
  line: number,
  id: string,
  command: string,
): TranscriptEvent => ({
  line,
  type: "assistant",
  message: {
    content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
  },
});

export const warningAttachment = (
  line: number,
  toolUseID: string,
  content: string,
): TranscriptEvent => ({
  line,
  type: "attachment",
  attachment: { type: "hook_additional_context", content, toolUseID },
});
