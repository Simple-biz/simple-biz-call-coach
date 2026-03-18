import { useState, useEffect, useMemo } from 'react'
import { Clock, MessageSquareText, Tag } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings-store'
import type { Transcription, CoachingTip, CallSession, CallState } from '@/types'

interface SessionStatsProps {
  transcriptions: Transcription[]
  coachingTips: CoachingTip[]
  session: CallSession | null
  callState: CallState
  compact?: boolean
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function SessionStats({ transcriptions, session, callState, compact }: SessionStatsProps) {
  const highlightKeywords = useSettingsStore(s => s.highlightKeywords)
  const [elapsed, setElapsed] = useState(0)

  // Duration timer
  useEffect(() => {
    if (!session?.startTime) {
      setElapsed(0)
      return
    }

    if (callState === 'active') {
      // Update immediately then every second
      setElapsed(Math.floor((Date.now() - session.startTime) / 1000))
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - session.startTime) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }

    // Call ended — show final duration
    if (session.endTime) {
      setElapsed(Math.floor((session.endTime - session.startTime) / 1000))
    }
  }, [session?.startTime, session?.endTime, callState])

  // Word count from final transcriptions
  const wordCount = useMemo(() => {
    const text = transcriptions
      .filter(t => t.isFinal)
      .map(t => t.text)
      .join(' ')
      .trim()
    return text ? text.split(/\s+/).length : 0
  }, [transcriptions])

  // Keyword match count
  const keywordCount = useMemo(() => {
    if (!highlightKeywords.length) return 0
    const text = transcriptions
      .filter(t => t.isFinal)
      .map(t => t.text)
      .join(' ')
    const escaped = highlightKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
    const matches = text.match(pattern)
    return matches ? matches.length : 0
  }, [transcriptions, highlightKeywords])

  const stats = [
    { icon: Clock, label: 'Duration', value: formatDuration(elapsed) },
    { icon: MessageSquareText, label: 'Words', value: String(wordCount) },
    { icon: Tag, label: 'Keywords', value: String(keywordCount) },
  ]

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2 px-2 py-1.5 bg-gray-800/50 rounded-md border border-gray-700/50">
            <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="text-xs text-gray-400">{label}</span>
            <span className="text-xs font-medium text-white ml-auto">{value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="border-t bg-card p-3">
      <div className="grid grid-cols-3 gap-2">
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex flex-col items-center gap-1 px-2 py-2 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <Icon className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-white">{value}</span>
            <span className="text-[10px] text-gray-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
