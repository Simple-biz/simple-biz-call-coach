/**
 * How a suggested line is shown (Kayser, 2026-10-23, UI pass). The placeholders only the agent can
 * fill ([Agent], [Place], [Bob's number], [their date]) are marked so they stand out mid-sentence,
 * and the question the line ends on, the thing the lead has to answer, is flagged.
 */
export type LineSegment = { text: string; kind: 'text' | 'placeholder'; question: boolean }

const LABELS: Record<string, string> = {
  '[agent]': 'your name',
  '[place]': 'your city',
  "[bob's number]": "Bob's number",
}

function placeholderSegments(text: string, question: boolean): LineSegment[] {
  return text
    .split(/(\[[^\]]+\])/)
    .filter((part) => part !== '')
    .map((part) => /^\[[^\]]+\]$/.test(part)
      ? { text: LABELS[part.toLowerCase().replace(/[’‘]/g, "'")] ?? part.slice(1, -1), kind: 'placeholder' as const, question }
      : { text: part, kind: 'text' as const, question })
}

/** The line in segments: placeholders marked, the closing question flagged. */
export function lineSegments(line: string): LineSegment[] {
  const t = line.trimEnd()
  // The last sentence, when the line ends on a question. Not split after "Dr." and the like.
  const last = t.split(/(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms|St|Jr)\.)\s+/).pop() ?? ''
  if (!t.endsWith('?') || !last) return placeholderSegments(t, false)
  const start = t.length - last.length
  return [...placeholderSegments(t.slice(0, start), false), ...placeholderSegments(t.slice(start), true)]
}
