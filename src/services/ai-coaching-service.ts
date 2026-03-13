// AI Coaching Service - Integrates with n8n workflow for real-time coaching
console.log('🤖 [AI Coaching Service] Module loaded')

export interface CoachingSuggestion {
  analysis: string
  suggestions: string[]
  priority: 'normal' | 'high'
  category: 'objection' | 'interest' | 'question' | 'closing' | 'info' | 'suggestion'
  timestamp: number
}

export interface CoachingServiceConfig {
  enabled: boolean
  webhookUrl: string
  timeoutMs?: number
}

export interface TranscriptionContext {
  transcript: string
  speaker: 'agent' | 'caller'
  timestamp: number
  conversationHistory?: Array<{
    speaker: string
    text: string
    timestamp: number
  }>
}

/**
 * AI Coaching Service
 *
 * Sends transcriptions to n8n workflow and receives AI-generated coaching suggestions
 */
class AICoachingService {
  private config: CoachingServiceConfig | null = null
  // private requestQueue: TranscriptionContext[] = [] // Reserved for future batching
  // private isProcessing = false // Reserved for queue processing
  private lastRequestTime = 0
  private readonly MIN_REQUEST_INTERVAL = 2000 // Minimum 2s between requests (cost control)

  /**
   * Initialize the coaching service with configuration
   */
  async initialize(): Promise<void> {
    try {
      const settings = await chrome.storage.local.get([
        'aiCoachingEnabled',
        'n8nWebhookUrl',
      ]) as { aiCoachingEnabled?: boolean; n8nWebhookUrl?: string }

      this.config = {
        enabled: settings.aiCoachingEnabled ?? false,
        webhookUrl: settings.n8nWebhookUrl || '',
        timeoutMs: 10000, // 10s timeout
      }

      console.log(
        `🤖 [AI Coaching] Initialized - Enabled: ${this.config!.enabled}, Webhook: ${this.config!.webhookUrl ? 'configured' : 'not configured'}`
      )
    } catch (error) {
      console.error('❌ [AI Coaching] Failed to initialize:', error)
      this.config = { enabled: false, webhookUrl: '' }
    }
  }

  /**
   * Update configuration (e.g., when user changes settings)
   */
  updateConfig(updates: Partial<CoachingServiceConfig>): void {
    if (!this.config) {
      this.config = { enabled: false, webhookUrl: '' }
    }
    this.config = { ...this.config, ...updates }
    console.log('🤖 [AI Coaching] Config updated:', this.config)
  }

  /**
   * Check if coaching service is ready
   */
  isReady(): boolean {
    if (!this.config) {
      return false
    }
    return this.config.enabled && !!this.config.webhookUrl
  }

  /**
   * Request coaching suggestions for a transcription
   *
   * This method:
   * 1. Checks if service is enabled
   * 2. Throttles requests to avoid excessive API calls
   * 3. Sends transcription to n8n webhook
   * 4. Returns AI-generated coaching suggestions
   */
  async getCoachingSuggestions(
    context: TranscriptionContext
  ): Promise<CoachingSuggestion | null> {
    // Check if service is ready
    if (!this.isReady()) {
      console.log('⚠️ [AI Coaching] Service not ready, skipping request')
      return null
    }

    // Only process final transcripts to reduce API costs
    // (Extension sends both interim and final transcripts)
    if (!context.transcript || context.transcript.trim().length === 0) {
      return null
    }

    // Throttle requests (cost control)
    const now = Date.now()
    if (now - this.lastRequestTime < this.MIN_REQUEST_INTERVAL) {
      console.log('⏱️ [AI Coaching] Throttling request (too soon)')
      return null
    }

    try {
      console.log(
        `🤖 [AI Coaching] Requesting suggestions for: "${context.transcript.substring(0, 50)}..."`
      )
      this.lastRequestTime = now

      const requestBody = {
        transcript: context.transcript,
        speaker: context.speaker,
        timestamp: context.timestamp,
        conversationHistory: context.conversationHistory || [],
      }

      // Send to n8n webhook
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config!.timeoutMs
      )

      const response = await fetch(this.config!.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!data.success || !data.coaching) {
        console.warn('⚠️ [AI Coaching] Invalid response format:', data)
        return null
      }

      const coaching: CoachingSuggestion = {
        analysis: data.coaching.analysis,
        suggestions: data.coaching.suggestions || [],
        priority: data.coaching.priority || 'normal',
        category: data.coaching.category || 'suggestion',
        timestamp: data.coaching.timestamp || Date.now(),
      }

      console.log(
        `✅ [AI Coaching] Received ${coaching.suggestions.length} suggestions`
      )
      return coaching
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('⏱️ [AI Coaching] Request timeout')
      } else {
        console.error('❌ [AI Coaching] Request failed:', error.message)
      }
      return null
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CoachingServiceConfig | null {
    return this.config
  }
}

// Export singleton instance
export const aiCoachingService = new AICoachingService()
