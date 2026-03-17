import type { ReactNode } from 'react'

export function highlightText(text: string, keywords: string[]): ReactNode {
  if (!keywords.length) return text

  // Escape special regex characters in keywords, then join with |
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')

  const parts = text.split(pattern)

  if (parts.length === 1) return text // No matches

  return parts.map((part, i) => {
    const isMatch = keywords.some(k => k.toLowerCase() === part.toLowerCase())
    if (isMatch) {
      return (
        <span key={i} style={{ backgroundColor: '#FFEB3B', color: '#000' }}>
          {part}
        </span>
      )
    }
    return part
  })
}