/**
 * Kayser's UI pass, 2026-10-23: placeholders marked, the line a new one replaced kept faded under it,
 * a close checklist, no empty thread box, no "Mk1 v1", and the closing question in bold. (The call
 * details box that filled the placeholders was removed at his request the same day.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatThread } from '@/components/ChatThread'
import { useSettingsStore } from '@/stores/settings-store'
import { useCallStore } from '@/stores/call-store'
import { lineSegments } from '@/utils/line-text'
import { closeProgress } from '@/utils/close-progress'
import type { Transcription } from '@/types'

Element.prototype.scrollIntoView = vi.fn()

const t = (speaker: Transcription['speaker'], text: string, isFinal = true): Transcription => ({
  id: `${speaker}-${text}`, speaker, text, isFinal, timestamp: 0, confidence: 1,
})
const line = (id: string, script: string) => ({ id, type: 'suggestion', label: 'Live coach', script, icon: 'zap' } as any)
const base = { callState: 'active' as const, isLoadingScripts: false, onSelectScript: () => {} }

beforeEach(() => {
  useSettingsStore.setState({ scriptTextSize: 'lg', compactMode: false })
  useCallStore.setState({ currentScriptOptions: [], previousScriptLine: null, transcriptions: [], streamingTip: null as any })
})

describe('lineSegments', () => {
  it('marks the placeholders with plain labels', () => {
    const segs = lineSegments("My name is [Agent]. Bob is in [Place]. Bob’s number is [Bob’s number].")
    expect(segs.filter((s) => s.kind === 'placeholder').map((s) => s.text)).toEqual(['your name', 'your city', "Bob's number"])
  })
  it('flags only the closing question', () => {
    const segs = lineSegments("It's Simple.biz. Would they talk to Dr. Patel about the website?")
    expect(segs.filter((s) => s.question).map((s) => s.text).join('')).toBe('Would they talk to Dr. Patel about the website?')
    expect(lineSegments('Perfect, I have everything I need.').some((s) => s.question)).toBe(false)
  })
  it("marks one only the agent can fill on the spot ([their date])", () => {
    expect(lineSegments('Until [their date], then.').find((s) => s.kind === 'placeholder')?.text).toBe('their date')
  })
})

describe('closeProgress', () => {
  it('ticks a question only once the lead answered it, and the yes and time from the confirmation', () => {
    const before = closeProgress([t('agent', 'Can I have your first name, please?')])
    expect(before.find((s) => s.key === 'name')!.done).toBe(false)
    const steps = closeProgress([
      t('agent', "My name is Jen. Real quick, Bob Hansen and I are local website designers here in Topeka. Just wanted to see if it makes sense to connect with someone local about building or updating your website?"),
      t('customer', 'Maybe. Tomorrow morning before ten is better.'),
      t('agent', "Sure, I'll have Bob call you tomorrow morning before ten. Can I have your first name, please?"),
      t('customer', "It's Dana."),
      t('agent', 'Would they talk to YOU about the website, or is there someone else in charge of that?'),
      t('customer', 'Me, I am the owner.'),
    ])
    const done = Object.fromEntries(steps.map((s) => [s.key, s.done]))
    // The pitch's "building or updating your website?" is not the close's build-or-update question.
    expect(done).toEqual({ yes: true, time: true, name: true, who: true, purpose: false })
  })
})

describe('previous line', () => {
  it('keeps the finished line a new one replaced, not a draft', () => {
    const s = useCallStore.getState()
    s.setCurrentScriptOptions([line('realtime-1', 'Hi Dana, how are you doing today?')])
    s.setCurrentScriptOptions([line('realtime-live', 'My name is')])
    expect(useCallStore.getState().previousScriptLine).toBe('Hi Dana, how are you doing today?')
    s.setCurrentScriptOptions([line('realtime-2', 'My name is [Agent]. Real quick...')])
    expect(useCallStore.getState().previousScriptLine).toBe('Hi Dana, how are you doing today?')
  })
  it('starts each call on the hello card with no previous line', () => {
    useCallStore.setState({ currentScriptOptions: [line('realtime-9', 'Thanks so much. Have a beautiful day!')], previousScriptLine: 'x' })
    useCallStore.getState().startCall()
    expect(useCallStore.getState().currentScriptOptions).toEqual([])
    expect(useCallStore.getState().previousScriptLine).toBeNull()
  })
})

describe('the card', () => {
  it('marks the placeholders, shows the line before it, and drops "Mk1 v1"', () => {
    useCallStore.setState({
      currentScriptOptions: [line('realtime-2', 'My name is [Agent]. Bob Hansen and I are local website designers here in [Place].')],
      previousScriptLine: 'Hi Dana, how are you doing today?',
      transcriptions: [t('customer', 'Doing alright.')],
    })
    render(<ChatThread {...base} transcriptions={useCallStore.getState().transcriptions} />)
    expect(screen.getByText('your name')).toBeTruthy()
    expect(screen.getByText('your city')).toBeTruthy()
    expect(screen.getByText('Before')).toBeTruthy()
    expect(screen.getByText('Hi Dana, how are you doing today?')).toBeTruthy()
    expect(screen.queryByText('Mk1 v1')).toBeNull()
    expect(screen.getByLabelText('Close checklist')).toBeTruthy()
  })
  it('has no call details box, and no checklist before anyone speaks', () => {
    render(<ChatThread {...base} transcriptions={[]} />)
    expect(screen.queryByText(/call details/i)).toBeNull()
    expect(screen.queryByLabelText('Close checklist')).toBeNull()
  })
  it('shows the empty thread as one line, not a tall box', () => {
    render(<ChatThread {...base} transcriptions={[]} />)
    const placeholder = screen.getByText('Listening for conversation...')
    expect(placeholder.parentElement!.className).not.toContain('py-20')
  })
})
