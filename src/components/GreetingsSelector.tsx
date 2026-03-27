import { MessageSquare, Zap, Sparkles, AlertCircle, ArrowRight } from 'lucide-react'
import { useCallStore } from '@/stores/call-store'
import type { ScriptOption } from '@/types'
import { logger } from '@/utils/logger'

interface GreetingsSelectorProps {
  isLoading?: boolean
  onSelect: (option: ScriptOption) => void
  onRegenerate?: () => void // Kept for interface compatibility but optional
}

// Initial greeting scripts for website builder sales
const INITIAL_GREETINGS: ScriptOption[] = [
  {
    id: 'greeting-basic',
    type: 'greeting',
    label: 'Greeting',
    script: "Hi, this is [Agent Name] from Simple.Biz. I'm reaching out about your business website - do you have a minute?",
    icon: 'message'
  }
]

export function GreetingsSelector({ isLoading = false, onSelect }: GreetingsSelectorProps) {
  const { currentScriptOptions } = useCallStore()

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
    if (isLoading || !option) return
    
    logger.log('🚀 [GreetingsSelector] User requested Next Suggestion (Context Refresh + Generate)')
    
    // 1. Refresh Context (Latest Transcription)
    useCallStore.getState().refreshContext()
    
    // 2. Request Next Suggestion (Golden Script Cross-reference)
    useCallStore.getState().requestNextSuggestion(option)
  }

  // handleRegenerate removed as it is now merged into handleNext

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-1.5 mb-0.5 px-1">
        <Sparkles className="w-3 h-3 text-[#1B1F6B]" />
        <span className="text-[9px] font-bold text-[#1B1F6B] uppercase tracking-widest">
          AI Suggested Line
        </span>
        {isLoading && (
          <div className="flex gap-0.5 ml-auto">
            <div className="w-1 h-1 bg-[#1B1F6B] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1 h-1 bg-[#1B1F6B] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1 h-1 bg-[#1B1F6B] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-[#1B1F6B] to-[#F5841F] rounded-lg blur opacity-10 group-hover:opacity-20 transition duration-500"></div>
        <div className="relative p-2.5 bg-white backdrop-blur-md border border-[#dddddd] rounded-lg shadow-lg">
          <div className="flex items-start gap-1.5">
            <div className="mt-0.5 p-1 rounded-md bg-[#1B1F6B]/10 border border-[#1B1F6B]/20">
              {option?.id?.includes('greeting') ? (
                <MessageSquare className="w-3 h-3 text-[#F5841F]" />
              ) : (
                <Zap className="w-3 h-3 text-[#1B1F6B]" />
              )}
            </div>
            <div className="flex-1 space-y-0.5 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-[#757575] uppercase tracking-tight">
                  {option?.label || 'Direct response'}
                </span>
                <span className="text-[8px] text-[#757575] font-mono">Mk1 v1</span>
              </div>
              <div
                className="text-[12px] leading-snug text-[#333333] font-medium selection:bg-[#1B1F6B]/30 cursor-pointer hover:bg-gray-100 p-0.5 rounded transition-colors"
                onClick={() => !isLoading && option && onSelect(option)}
                title="Click to use this script"
              >
                {isLoading ? (
                  <div className="space-y-1 py-1">
                    <div className="h-2.5 w-full bg-gray-200 rounded animate-pulse" />
                    <div className="h-2.5 w-2/3 bg-gray-200 rounded animate-pulse" />
                  </div>
                ) : (
                  option?.script
                )}
              </div>
            </div>
          </div>

          {!isLoading && (
            <div className="mt-2 text-center">
              <button
                onClick={handleNext}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-[#1B1F6B] hover:bg-[#14174f] text-white text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-200 active:scale-[0.97]"
                title="Refresh context from live transcript and get tailored suggestion"
              >
                Get Next Suggestion
                <ArrowRight className="w-3 h-3" />
              </button>
              <p className="mt-1.5 text-[8px] text-[#757575] font-medium italic">
                Refreshes context • Cross-references Golden Script • Tailored
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { INITIAL_GREETINGS }
