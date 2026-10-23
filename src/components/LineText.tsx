import { lineSegments } from '@/utils/line-text'

/**
 * A suggested line as the agent reads it: placeholders ([Agent], [Place], [Bob's number]) marked in
 * amber, and the closing question, the part the lead has to answer, bold.
 */
export function LineText({ line }: { line: string }) {
  return (
    <>
      {lineSegments(line).map((seg, i) =>
        seg.kind === 'placeholder' ? (
          <span
            key={i}
            className="px-1 mx-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i} className={seg.question ? 'font-bold text-[#1B1F6B]' : ''}>
            {seg.text}
          </span>
        ),
      )}
    </>
  )
}
