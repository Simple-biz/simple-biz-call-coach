import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Settings } from '@/types'

interface SettingsStore extends Settings {
  setDeepgramApiKey: (key: string) => void
  setN8nWebhookUrl: (url: string) => void
  setAiCoachingEnabled: (enabled: boolean) => void
  setAudioSensitivity: (sensitivity: number) => void
  setEnableNotifications: (enabled: boolean) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      deepgramApiKey: '',
      n8nWebhookUrl: '',
      aiCoachingEnabled: false,
      audioSensitivity: 0.1,
      enableNotifications: true,
      theme: 'system',

      setDeepgramApiKey: (deepgramApiKey) => set({ deepgramApiKey }),
      setN8nWebhookUrl: (n8nWebhookUrl) => set({ n8nWebhookUrl }),
      setAiCoachingEnabled: (aiCoachingEnabled) => set({ aiCoachingEnabled }),
      setAudioSensitivity: (audioSensitivity) => set({ audioSensitivity }),
      setEnableNotifications: (enableNotifications) => set({ enableNotifications }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'devassist-settings',
    }
  )
)
