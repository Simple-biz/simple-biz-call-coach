import { MessageSquare, Zap, Sparkles, AlertCircle, ArrowRight, RotateCcw, Copy, CheckCircle2, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { useCallStore } from '@/stores/call-store'
import type { ScriptOption } from '@/types'
import { logger } from '@/utils/logger'

interface SimpleSuggestionDisplayProps {
  isLoading?: boolean
  onSelect: (option: ScriptOption) => void
  onRegenerate?: () => void
  performanceMetrics?: {
    totalLatency?: number
    aiLatency?: number
    cacheHitRate?: number
    meetsTarget?: boolean
  }
  stage?: 'GREETING' | 'VALUE_PROP' | 'OBJECTION' | 'CLOSING' | 'CONVERSION' | string
  model?: string
}

// Initial greeting scripts for website builder sales
const INITIAL_GREETINGS: ScriptOption[] = [
  {
    id: 'greeting-basic',
    type: 'basic',
    label: 'Basic',
    script: "Hi, this is [Agent Name] from Simple.Biz. I'm reaching out about your business website - do you have a minute?",
    icon: 'message'
  }
]

export function SimpleSuggestionDisplay({
  isLoading = false,
  onSelect,
  onRegenerate,
  performanceMetrics,
  stage = 'GREETING',
  model = 'haiku'
}: SimpleSuggestionDisplayProps) {
  const { currentScriptOptions } = useCallStore()
  const [copied, setCopied] = useState(false)

  // Use the single option if available, otherwise fallback to first initial greeting
  const option = currentScriptOptions.length > 0
    ? currentScriptOptions[0]
    : INITIAL_GREETINGS[0]

  if (!option && !isLoading) {
    return (
      <div className="flex items-center gap-2 p-3 bg-gray-800/30 rounded-lg border border-white/5 text-gray-500 italic text-xs">
        <AlertCircle className="w-3 h-3" />
        Waiting for conversation to begin...
      </div>
    )
  }

  const handleNext = () => {
    if (isLoading || !option) return
    logger.log('🚀 [SimpleSuggestionDisplay] User requested next suggestion (Rephrase)')
    useCallStore.getState().requestNextSuggestion(option)
  }

  const handleRegenerate = () => {
    if (isLoading || !onRegenerate) return
    logger.log('🔄 [SimpleSuggestionDisplay] User requested refresh (New Context)')
    useCallStore.getState().refreshContext()
  }

  const handleCopy = async () => {
    if (!option?.script) return
    try {
      await navigator.clipboard.writeText(option.script)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      logger.log('📋 [SimpleSuggestionDisplay] Script copied to clipboard')
    } catch (error) {
      logger.error('❌ [SimpleSuggestionDisplay] Failed to copy to clipboard:', error)
    }
  }

  const getStageColor = (stage: string) => {
    switch (stage.toUpperCase()) {
      case 'GREETING': return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
      case 'VALUE_PROP': return 'text-green-400 bg-green-500/10 border-green-500/30'
      case 'OBJECTION': return 'text-orange-400 bg-orange-500/10 border-orange-500/30'
      case 'CLOSING': return 'text-purple-400 bg-purple-500/10 border-purple-500/30'
      case 'CONVERSION': return 'text-pink-400 bg-pink-500/10 border-pink-500/30'
      default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
    }
  }

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-2 mb-1 px-1">
        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-[10px] font-bold text-purple-300 uppercase tracking-widest">
          AI Suggested Line
        </span>
        {stage && (
          <span className={`ml-auto text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${getStageColor(stage)}`}>
            {stage}
          </span>
        )}
        {isLoading && (
          <div className="flex gap-1 ml-2">
            <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl blur opacity-10 group-hover:opacity-25 transition duration-500"></div>
        <div className="relative p-4 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-1 p-2 rounded-lg bg-purple-500/10 border border-purple-500/30">
              {option?.id?.includes('greeting') ? (
                <MessageSquare className="w-4 h-4 text-blue-400" />
              ) : (
                <Zap className="w-4 h-4 text-purple-400" />
              )}
            </div>
            <div className="flex-1 space-y-1.5 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">
                  {option?.label || 'Direct response'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-600 font-mono">{model}</span>
                  <button
                    onClick={handleCopy}
                    className="p-1 hover:bg-white/5 rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? (
                      <CheckCircle2 className="w-3 h-3 text-green-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-gray-500" />
                    )}
                  </button>
                </div>
              </div>
              <div
                className="text-[14px] leading-relaxed text-white font-medium selection:bg-purple-500/30 cursor-pointer hover:bg-white/5 p-1 rounded transition-colors"
                onClick={() => !isLoading && option && onSelect(option)}
                title="Click to use this script"
              >
                {isLoading ? (
                  <div className="space-y-2 py-1">
                    <div className="h-3 w-full bg-gray-800 rounded animate-pulse" />
                    <div className="h-3 w-2/3 bg-gray-800 rounded animate-pulse" />
                  </div>
                ) : (
                  option?.script
                )}
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          {performanceMetrics && !isLoading && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="flex items-center gap-3 text-[10px]">
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-gray-500" />
                  <span className="text-gray-500">Performance:</span>
                </div>
                {performanceMetrics.totalLatency !== undefined && (
                  <div className={`flex items-center gap-1 ${performanceMetrics.meetsTarget ? 'text-green-400' : 'text-orange-400'}`}>
                    <span className="font-mono font-bold">{performanceMetrics.totalLatency}ms</span>
                    {performanceMetrics.meetsTarget ? '✓' : '⚠'}
                  </div>
                )}
                {performanceMetrics.cacheHitRate !== undefined && (
                  <div className="text-gray-400">
                    Cache: <span className="font-mono text-gray-300">{Math.round(performanceMetrics.cacheHitRate * 100)}%</span>
                  </div>
                )}
                {performanceMetrics.aiLatency !== undefined && (
                  <div className="text-gray-500">
                    AI: <span className="font-mono text-gray-400">{performanceMetrics.aiLatency}ms</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isLoading && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleNext}
                className="flex-[3] flex items-center justify-center gap-2 py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all duration-200 active:scale-[0.97]"
              >
                Get Next Suggestion
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleRegenerate}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] font-bold uppercase border border-white/5 rounded-lg transition-all duration-200 active:scale-[0.95]"
                title="Regenerate contextually"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {!isLoading && (
        <div className="flex items-center justify-center gap-1.5 px-4 opacity-50 group-hover:opacity-80 transition-opacity">
          <div className="w-1 h-1 bg-gray-500 rounded-full" />
          <p className="text-[9px] text-gray-500 font-medium italic">
            Read precisely or click refresh for new context
          </p>
          <div className="w-1 h-1 bg-gray-500 rounded-full" />
        </div>
      )}
    </div>
  )
}

export { INITIAL_GREETINGS }
