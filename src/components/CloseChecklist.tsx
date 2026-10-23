import { Check } from 'lucide-react'
import { useCallStore } from '@/stores/call-store'
import { closeProgress } from '@/utils/close-progress'

/** What's left before the agent can wrap up a booked call (close-progress.ts). */
export function CloseChecklist() {
  const transcriptions = useCallStore((s) => s.transcriptions)
  const steps = closeProgress(transcriptions)
  return (
    <div className="flex flex-wrap items-center gap-1 px-1" aria-label="Close checklist">
      <span className="text-[9px] font-bold uppercase tracking-wider text-[#757575] mr-0.5">Close</span>
      {steps.map((s) => (
        <span
          key={s.key}
          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
            s.done
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
              : 'bg-white text-[#757575] border-[#dddddd]'
          }`}
        >
          {s.done && <Check className="w-2.5 h-2.5" />}
          {s.label}
        </span>
      ))}
    </div>
  )
}
