import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings-store'
import { useShallow } from 'zustand/react/shallow'

const FIELDS = [
  { key: 'agentName', label: 'Your name on calls', placeholder: 'e.g. Jen' },
  { key: 'agentPlace', label: 'Your city', placeholder: 'e.g. Topeka' },
  { key: 'bobNumber', label: "Bob's number", placeholder: 'e.g. 785-555-0100' },
] as const

/**
 * What the coach's placeholders stand for, saved once. Open while any is missing; afterwards a small
 * "Your call details" link edits them.
 */
export function CallDetails() {
  // Flat selector: useShallow compares one level deep, so a nested object would re-render forever.
  const { agentName, agentPlace, bobNumber, setCallDetails } = useSettingsStore(
    useShallow((s) => ({ agentName: s.agentName, agentPlace: s.agentPlace, bobNumber: s.bobNumber, setCallDetails: s.setCallDetails })),
  )
  const values = { agentName, agentPlace, bobNumber }
  const missing = FIELDS.some((f) => !values[f.key].trim())
  const [open, setOpen] = useState(false)

  if (!missing && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 px-1 text-[10px] text-[#757575] hover:text-[#1B1F6B]"
        title="Edit what fills [Agent], [Place] and [Bob's number] in your lines"
      >
        <Pencil className="w-2.5 h-2.5" /> Your call details
      </button>
    )
  }
  return (
    <div className="p-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">
          Your call details: filled into your lines
        </span>
        {!missing && (
          <button onClick={() => setOpen(false)} className="text-[10px] font-semibold text-[#1B1F6B]">
            Done
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[9px] text-[#757575] truncate">{f.label}</span>
            <input
              value={values[f.key]}
              onChange={(e) => setCallDetails({ [f.key]: e.target.value })}
              placeholder={f.placeholder}
              className="w-full min-w-0 px-1.5 py-1 text-[12px] rounded border border-[#dddddd] bg-white text-[#333333] focus:outline-none focus:border-[#1B1F6B]"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
