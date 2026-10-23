/**
 * The close checklist (Kayser, 2026-10-23, UI pass): what's left before the agent can wrap up, so
 * nobody has to ask "you said you had one more question?". The five things the top bookers get on
 * a booked call, each ticked from the transcript once it's settled: a question only counts when the
 * agent asked it and the lead said something after.
 */
import type { Transcription } from '@/types'

export type CloseStep = { key: 'yes' | 'time' | 'name' | 'who' | 'purpose'; label: string; done: boolean }

// The pitch ends on "...building or updating your website?": that's not the close's question.
const PITCH = /Bob Ha[nm]+[sz]?on and I|local website designers/i
const CONFIRMED = /\bI'll have Bob\b[^.?!]*\b(?:call|reach out)|\bBob (?:or his partner )?will (?:give you a call|call you|reach out)|everything I need/i
const THEIR_TIME = /\b(?:tomorrow|today|tonight|morning|afternoon|evening|noon|o'clock|monday|tuesday|wednesday|thursday|friday|next week|(?:at|after|before|around) (?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|in (?:\d+|an?|a few) (?:minutes?|hours?))\b/i

export function closeProgress(transcriptions: Transcription[]): CloseStep[] {
  const finals = transcriptions.filter((t) => t.isFinal && t.text.trim())
  const agent = finals.map((t, i) => ({ t, i })).filter(({ t }) => t.speaker === 'agent')
  const answeredAfter = (i: number) => finals.slice(i + 1).some((t) => t.speaker === 'customer')
  const askedAndAnswered = (question: RegExp) =>
    agent.some(({ t, i }) => question.test(t.text) && !PITCH.test(t.text) && answeredAfter(i))
  const confirmed = agent.some(({ t }) => CONFIRMED.test(t.text) && !/would you mind/i.test(t.text))
  const time = finals.some((t) => t.speaker === 'customer' && THEIR_TIME.test(t.text))
    || agent.some(({ t }) => CONFIRMED.test(t.text) && THEIR_TIME.test(t.text))
  return [
    { key: 'yes', label: 'Callback yes', done: confirmed },
    { key: 'time', label: 'Time', done: time },
    { key: 'name', label: 'Name', done: askedAndAnswered(/first name|your name/i) },
    { key: 'who', label: 'Who decides', done: askedAndAnswered(/in charge|handles the website|talk to you about the website|the one who/i) },
    { key: 'purpose', label: 'Build or update', done: askedAndAnswered(/build(?:ing)? a new|new website|updat(?:e|ing)/i) },
  ]
}
