import { useSettingsStore } from '@/stores/settings-store'
import { useShallow } from 'zustand/react/shallow'
import { lineSegments } from '@/utils/line-text'

/**
 * A suggested line as the agent reads it: [Agent], [Place] and [Bob's number] filled from their call
 * details (amber when not set yet), and the closing question, the part the lead has to answer, bold.
 */
export function LineText({ line }: { line: string }) {
  const details = useSettingsStore(useShallow((s) => ({ agentName: s.agentName, agentPlace: s.agentPlace, bobNumber: s.bobNumber })))
  return (
    <>
      {lineSegments(line, details).map((seg, i) => {
        const question = seg.question ? 'font-bold text-[#1B1F6B]' : ''
        if (seg.kind === 'missing') {
          return (
            <span
              key={i}
              className="px-1 mx-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700"
              title="Not set yet: fill it in under Your call details"
            >
              {seg.text}
            </span>
          )
        }
        return (
          <span key={i} className={question}>
            {seg.text}
          </span>
        )
      })}
    </>
  )
}
