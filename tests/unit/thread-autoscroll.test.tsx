/**
 * Ported from Call Coach HSL: the transcript should follow the newest words unless the agent scrolls up.
 * jsdom has no layout, so scrollHeight / clientHeight are faked on the scroll container.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ChatThread } from '@/components/ChatThread'
import { useCallStore } from '@/stores/call-store'
import type { Transcription } from '@/types'

const t = (i: number): Transcription => ({ id: `t${i}`, speaker: i % 2 ? 'agent' : 'customer', text: `line ${i}`, isFinal: true, timestamp: i, confidence: 1 })
const base = { callState: 'active' as const, isLoadingScripts: false, onSelectScript: () => {} }

/** The thread's scroll container, with fake geometry: content height grows 100px per line. */
function container(lines: number) {
  const el = document.querySelector('.custom-scrollbar') as HTMLDivElement
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: lines * 100 })
  return el
}

beforeEach(() => useCallStore.setState({ currentScriptOptions: [], streamingTip: null as any }))

describe('transcript auto-scroll', () => {
  it('follows the newest line while the agent has not scrolled up', () => {
    const lines = [t(0), t(1), t(2), t(3), t(4)]
    const { rerender } = render(<ChatThread {...base} transcriptions={lines} />)
    const el = container(6)
    rerender(<ChatThread {...base} transcriptions={[...lines, t(5)]} />)
    expect(el.scrollTop).toBe(600)
    expect(screen.queryByText('Jump to latest')).not.toBeInTheDocument()
  })

  it('stops following when the agent scrolls up, and offers Jump to latest', () => {
    const lines = [t(0), t(1), t(2), t(3), t(4)]
    const { rerender } = render(<ChatThread {...base} transcriptions={lines} />)
    const el = container(6)
    act(() => { el.scrollTop = 100; fireEvent.scroll(el) }) // agent scrolls up to read
    rerender(<ChatThread {...base} transcriptions={[...lines, t(5)]} />)
    expect(el.scrollTop).toBe(100) // left where they were reading
    fireEvent.click(screen.getByText('Jump to latest'))
    expect(el.scrollTop).toBe(600)
    expect(screen.queryByText('Jump to latest')).not.toBeInTheDocument()
  })

  it('resumes following when the agent scrolls back to the bottom themselves', () => {
    const lines = [t(0), t(1), t(2), t(3), t(4)]
    const { rerender } = render(<ChatThread {...base} transcriptions={lines} />)
    const el = container(6)
    act(() => { el.scrollTop = 100; fireEvent.scroll(el) })
    act(() => { el.scrollTop = 290; fireEvent.scroll(el) }) // within 40px of the bottom
    container(7)
    rerender(<ChatThread {...base} transcriptions={[...lines, t(5)]} />)
    expect(el.scrollTop).toBe(700)
  })
})
