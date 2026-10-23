import { MessageSquare, Zap, Sparkles, AlertCircle, ArrowRight } from 'lucide-react'
import { useCallStore } from '@/stores/call-store'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '@/stores/settings-store'
import { OPENING_GREETING } from '../../infra/lib/experiments/live-coach-instructions'
import { LineText } from './LineText'
import { CallDetails } from './CallDetails'
import { CloseChecklist } from './CloseChecklist'
import type { ScriptOption, ScriptTextSize } from '@/types'
import { logger } from '@/utils/logger'

interface GreetingsSelectorProps {
  isLoading?: boolean
  onSelect: (option: ScriptOption) => void
  onRegenerate?: () => void // Kept for interface compatibility but optional
}

// The card before the first line arrives: the hello the top bookers open with, the same line the live
// coach is told to give first; the pitch follows once the lead answers (live-coach-instructions.ts).
const INITIAL_GREETINGS: ScriptOption[] = [
  {
    id: 'greeting-basic',
    type: 'greeting',
    label: 'Opener',
    script: OPENING_GREETING,
    icon: 'message'
  }
]

// Agents read this line aloud mid-call, often on one shared monitor: it was 13px with tight
// leading. Default is now `lg`; the A/A+/A++ control in the side-panel header switches size.
// (Ported from Call Coach HSL's panel-readability work.)
const SCRIPT_TEXT_CLASS: Record<ScriptTextSize, string> = {
  md: 'text-[15px] leading-normal',
  lg: 'text-[17px] leading-relaxed',
  xl: 'text-[20px] leading-relaxed',
}

export function GreetingsSelector({ isLoading = false, onSelect }: GreetingsSelectorProps) {
  const scriptTextSize = useSettingsStore((s) => s.scriptTextSize)
  // Selector + useShallow instead of a bare `useCallStore()`: a bare call subscribes to the whole
  // store, so the card re-rendered on every transcript line and audio-level tick. Now that the
  // Script tab shows this card all call long, it re-renders only when these fields change.
  const { currentScriptOptions, streamingTip, realtimeLive, previousScriptLine, callHasWords } = useCallStore(
    useShallow((s) => ({
      currentScriptOptions: s.currentScriptOptions,
      streamingTip: s.streamingTip,
      realtimeLive: s.realtimeLive,
      previousScriptLine: s.previousScriptLine,
      callHasWords: s.transcriptions.length > 0,
    }))
  )
  const isStreaming = !!streamingTip

  // Use the single option if available, otherwise fallback to first initial greeting
  const option = currentScriptOptions.length > 0
    ? currentScriptOptions[0]
    : INITIAL_GREETINGS[0]

  if (!option && !isLoading) {
    return (
      <div className="flex items-center gap-2 p-3 bg-[#F5F7FA] rounded-lg border border-[#dddddd] text-[#757575] italic text-xs">
        <AlertCircle className="w-3 h-3" />
        Waiting for conversation to begin...
      </div>
    )
  }

  const handleNext = () => {
    if (isLoading || isStreaming || !option) return
    
    logger.log('🚀 [GreetingsSelector] User requested Next Suggestion (Context Refresh + Generate)')
    
    useCallStore.getState().refreshContext()
    useCallStore.getState().requestNextSuggestion(option)
  }

  // handleRegenerate removed as it is now merged into handleNext

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-1.5 mb-0.5 px-1">
        <Sparkles className="w-3 h-3 text-[#1B1F6B]" />
        <span className="text-[10px] font-bold text-[#1B1F6B] uppercase tracking-widest">
          AI Suggested Line
        </span>
        {(isLoading || isStreaming) && (
          <div className="flex gap-0.5 ml-auto">
            <div className="w-1 h-1 bg-[#1B1F6B] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1 h-1 bg-[#1B1F6B] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1 h-1 bg-[#1B1F6B] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      <CallDetails />

      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-[#1B1F6B] to-[#1B1F6B] rounded-lg blur opacity-10 group-hover:opacity-20 transition duration-500"></div>
        <div className="relative p-3 bg-white backdrop-blur-md border border-[#dddddd] rounded-lg shadow-lg">
          <div className="flex items-start gap-1.5">
            <div className="mt-0.5 p-1 rounded-md bg-[#1B1F6B]/10 border border-[#1B1F6B]/20">
              {option?.id?.includes('greeting') ? (
                <MessageSquare className="w-3 h-3 text-[#1B1F6B]" />
              ) : (
                <Zap className="w-3 h-3 text-[#1B1F6B]" />
              )}
            </div>
            <div className="flex-1 space-y-0.5 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-[#757575] uppercase tracking-tight">
                  {option?.label || 'Direct response'}
                </span>
              </div>
              {/* Keyed on the line it replaced, so a new line fades in once (a draft turning into
                  its finished line doesn't flash again). */}
              <div
                key={previousScriptLine ?? 'first'}
                className={`${SCRIPT_TEXT_CLASS[scriptTextSize] ?? SCRIPT_TEXT_CLASS.lg} text-[#333333] font-medium selection:bg-[#1B1F6B]/30 cursor-pointer hover:bg-gray-100 p-0.5 rounded transition-colors animate-in fade-in slide-in-from-bottom-1 duration-500`}
                onClick={() => !isLoading && !isStreaming && option && onSelect(option)}
                title={isStreaming ? "Generating..." : "Click to use this script"}
              >
                {isLoading ? (
                  <div className="space-y-1 py-1">
                    <div className="h-2.5 w-full bg-gray-200 rounded animate-pulse" />
                    <div className="h-2.5 w-2/3 bg-gray-200 rounded animate-pulse" />
                  </div>
                ) : (
                  <>
                    <LineText line={option?.script ?? ''} />
                    {isStreaming && <span className="inline-block w-0.5 h-3.5 bg-[#1B1F6B] ml-0.5 align-middle animate-pulse" />}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* The line it replaced, faded: an agent caught mid-read can still finish it. */}
          {previousScriptLine && (
            <div className="mt-2 pt-1.5 border-t border-dashed border-[#dddddd] text-[12px] leading-snug text-[#757575] opacity-70 line-clamp-2">
              <span className="text-[9px] font-bold uppercase tracking-wider mr-1">Before</span>
              <LineText line={previousScriptLine} />
            </div>
          )}

          {realtimeLive && !callHasWords && (
            <p className="mt-2 text-center text-[10px] text-[#757575] font-medium italic">
              Live coach is on: the next line appears as the lead talks.
            </p>
          )}

          {!isLoading && !realtimeLive && (
            <div className="mt-2 text-center">
              <button
                onClick={handleNext}
                disabled={isStreaming}
                className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-white text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-200 ${
                  isStreaming
                    ? 'bg-[#1B1F6B]/50 cursor-not-allowed'
                    : 'bg-[#1B1F6B] hover:bg-[#14174f] active:scale-[0.97]'
                }`}
                title={isStreaming ? "Generating suggestion..." : "Refresh context from live transcript and get tailored suggestion"}
              >
                {isStreaming ? 'Generating...' : 'Get Next Suggestion'}
                {!isStreaming && <ArrowRight className="w-3 h-3" />}
              </button>
              <p className="mt-1.5 text-[8px] text-[#757575] font-medium italic">
                {isStreaming ? 'Streaming AI response...' : 'Refreshes context • Cross-references Golden Script • Tailored'}
              </p>
            </div>
          )}
        </div>
      </div>

      {callHasWords && <CloseChecklist />}
    </div>
  )
}

export { INITIAL_GREETINGS }
