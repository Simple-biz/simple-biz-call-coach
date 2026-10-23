/**
 * How a suggested line is shown (Kayser, 2026-10-23, UI pass). The coach writes placeholders for
 * what only the agent knows ([Agent], [Place], [Bob's number]); agents were swapping them in their
 * heads mid-sentence. They are filled from the agent's call details, and any not set yet are marked
 * so it's clear what to say. The question the line ends on, the thing the lead has to answer, is
 * marked too.
 */
export type CallDetails = { agentName: string; agentPlace: string; bobNumber: string }

export type LineSegment = { text: string; kind: 'text' | 'filled' | 'missing'; question: boolean }

const PLACEHOLDERS: Record<string, { field: keyof CallDetails; label: string }> = {
  '[agent]': { field: 'agentName', label: 'your name' },
  '[place]': { field: 'agentPlace', label: 'your city' },
  "[bob's number]": { field: 'bobNumber', label: "Bob's number" },
}

function placeholderSegments(text: string, details: CallDetails, question: boolean): LineSegment[] {
  return text
    .split(/(\[[^\]]+\])/)
    .filter((part) => part !== '')
    .map((part) => {
      if (!/^\[[^\]]+\]$/.test(part)) return { text: part, kind: 'text' as const, question }
      const known = PLACEHOLDERS[part.toLowerCase().replace(/[’‘]/g, "'")]
      const value = known ? details[known.field].trim() : ''
      if (value) return { text: value, kind: 'filled' as const, question }
      // Not set yet, or one only the agent can fill on the spot ([their date]).
      return { text: known ? known.label : part.slice(1, -1), kind: 'missing' as const, question }
    })
}

/** The line in segments: placeholders filled or marked missing, the closing question flagged. */
export function lineSegments(line: string, details: CallDetails): LineSegment[] {
  const t = line.trimEnd()
  // The last sentence, when the line ends on a question. Not split after "Dr." and the like.
  const last = t.split(/(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms|St|Jr)\.)\s+/).pop() ?? ''
  if (!t.endsWith('?') || !last) return placeholderSegments(t, details, false)
  const start = t.length - last.length
  return [...placeholderSegments(t.slice(0, start), details, false), ...placeholderSegments(t.slice(start), details, true)]
}
