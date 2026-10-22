import type { Transcription } from "@/types";

/**
 * One speech bubble in the live thread: every consecutive fragment from the same speaker,
 * joined into a paragraph.
 *
 * Why: Deepgram finalises on short pauses, so a lead who pauses between digit groups —
 * "123 … 45 … 6789" — arrives as three finals and used to render as three bubbles. Agents
 * read numbers back off the panel, so they need them in one place. (Ported from Call Coach HSL.)
 *
 * Display only: the store, the export and the backend still see the original fragments.
 */
export interface TranscriptParagraph {
  id: string;
  speaker: Transcription["speaker"];
  /** Timestamp of the first fragment in the paragraph. */
  timestamp: number;
  /** Final text, fragments joined with a single space. */
  text: string;
  /** Trailing interim (not yet final) text, shown greyed after `text`. */
  interim: string;
}

export function groupTranscriptions(transcriptions: Transcription[]): TranscriptParagraph[] {
  const out: TranscriptParagraph[] = [];
  transcriptions.forEach((t, i) => {
    const text = t.text?.trim();
    if (!text) return;
    const last = out[out.length - 1];
    if (!last || last.speaker !== t.speaker) {
      out.push({
        id: t.id || `p-${i}`,
        speaker: t.speaker,
        timestamp: t.timestamp,
        text: t.isFinal ? text : "",
        interim: t.isFinal ? "" : text,
      });
      return;
    }
    if (t.isFinal) {
      last.text = last.text ? `${last.text} ${text}` : text;
      // A final supersedes whatever interim preceded it.
      last.interim = "";
    } else {
      last.interim = text;
    }
  });
  return out;
}
