import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Settings, ScriptTextSize } from '@/types'

interface SettingsStore extends Settings {
  setDeepgramApiKey: (key: string) => void
  setN8nWebhookUrl: (url: string) => void
  setAiCoachingEnabled: (enabled: boolean) => void
  setAudioSensitivity: (sensitivity: number) => void
  setEnableNotifications: (enabled: boolean) => void
  setHighlightKeywords: (keywords: string[]) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setCompactMode: (compactMode: boolean) => void
  setScriptTextSize: (scriptTextSize: ScriptTextSize) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      deepgramApiKey: '',
      n8nWebhookUrl: '',
      aiCoachingEnabled: false,
      audioSensitivity: 0.1,
      enableNotifications: true,
      highlightKeywords: ['price', 'pricing', 'cost', 'budget', 'contract', 'sign', 'decision', 'timeline', 'competitor'],
      theme: 'system',
      compactMode: false,
      scriptTextSize: 'lg',

      setDeepgramApiKey: (deepgramApiKey) => set({ deepgramApiKey }),
      setN8nWebhookUrl: (n8nWebhookUrl) => set({ n8nWebhookUrl }),
      setAiCoachingEnabled: (aiCoachingEnabled) => set({ aiCoachingEnabled }),
      setAudioSensitivity: (audioSensitivity) => set({ audioSensitivity }),
      setHighlightKeywords: (highlightKeywords) => set({ highlightKeywords }),
      setEnableNotifications: (enableNotifications) => set({ enableNotifications }),
      setTheme: (theme) => set({ theme }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setScriptTextSize: (scriptTextSize) => set({ scriptTextSize }),
    }),
    {
      name: 'devassist-settings',
    }
  )
)
