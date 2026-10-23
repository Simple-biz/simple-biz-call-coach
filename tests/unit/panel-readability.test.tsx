/**
 * Ported from Call Coach HSL (agent feedback 2026-10): lead numbers split across bubbles, the panel is too big for one
 * monitor, and the suggested line is hard to read. These pin the three fixes at render level.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatThread } from '@/components/ChatThread'
import { useSettingsStore } from '@/stores/settings-store'
import { useCallStore } from '@/stores/call-store'
import type { Transcription } from '@/types'

// jsdom has no scrollIntoView; the thread auto-scrolls on every update.
Element.prototype.scrollIntoView = vi.fn()

const t = (speaker: Transcription['speaker'], text: string, isFinal = true): Transcription => ({
  id: `${speaker}-${text}`, speaker, text, isFinal, timestamp: 0, confidence: 1,
})

const SCRIPT = 'What is your highest level of education?'

const base = {
  callState: 'active' as const,
  isLoadingScripts: false,
  onSelectScript: () => {},
}

beforeEach(() => {
  useSettingsStore.setState({ scriptTextSize: 'lg', compactMode: false })
  useCallStore.setState({
    currentScriptOptions: [{ id: 'tip-1', type: 'question', label: 'Education', script: SCRIPT, icon: 'zap' } as any],
    streamingTip: null as any,
  })
})

describe('live thread paragraphs', () => {
  it('renders a lead\'s digit groups as one bubble', () => {
    render(<ChatThread {...base} transcriptions={[
      t('agent', "What's your phone number?"),
      t('customer', 'Yeah it is 555'),
      t('customer', '867'),
      t('customer', '5309.'),
    ]} />)
    expect(screen.getByText('Yeah it is 555 867 5309.')).toBeInTheDocument()
    expect(screen.getAllByText('Customer')).toHaveLength(1)
  })
})

describe('collapsed / compact thread', () => {
  it('keeps the suggested line visible when the thread is collapsed', () => {
    render(<ChatThread {...base} collapsed transcriptions={[t('customer', 'hello')]} />)
    expect(screen.getByText(SCRIPT)).toBeInTheDocument()
    // the transcript itself is not rendered when collapsed and not compact
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('compact mode also shows the caller\'s latest answer, joined', () => {
    render(<ChatThread {...base} collapsed compact transcriptions={[
      t('customer', 'old answer'),
      t('agent', 'And your social?'),
      t('customer', 'It is 123'),
      t('customer', '45 6789', false),
    ]} />)
    expect(screen.getByText(SCRIPT)).toBeInTheDocument()
    expect(screen.getByText('Customer said')).toBeInTheDocument()
    expect(screen.getByText(/It is 123/)).toBeInTheDocument()
    expect(screen.getByText(/45 6789/)).toBeInTheDocument()
    expect(screen.queryByText('old answer')).not.toBeInTheDocument()
  })

  it('the bar reopens the thread', () => {
    const onToggleCollapse = vi.fn()
    render(<ChatThread {...base} collapsed compact onToggleCollapse={onToggleCollapse} transcriptions={[]} />)
    fireEvent.click(screen.getByText('Live Thread'))
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })
})

describe('suggested line size', () => {
  it.each([['md', 'text-[15px]'], ['lg', 'text-[17px]'], ['xl', 'text-[20px]']] as const)(
    '%s renders at %s',
    (size, cls) => {
      useSettingsStore.setState({ scriptTextSize: size })
      render(<ChatThread {...base} collapsed transcriptions={[]} />)
      // The line renders in segments (the closing question is its own bold span), so the size
      // class is on the line's container.
      expect(screen.getByText(SCRIPT).closest('div')!.className).toContain(cls)
    },
  )
})
