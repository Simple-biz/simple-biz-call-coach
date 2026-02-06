/**
 * Push-to-Talk Deepgram Service
 *
 * Handles microphone capture and real-time Deepgram transcription
 * for sandbox mode agent voice input.
 *
 * Features:
 * - Microphone capture on demand (button press)
 * - Real-time Deepgram WebSocket connection
 * - Interim and final transcription
 * - Audio level monitoring
 * - Automatic cleanup on button release
 */

export type PTTStatus = 'idle' | 'connecting' | 'recording' | 'error';

export interface PTTTranscription {
  text: string;
  isFinal: boolean;
  confidence: number;
}

export class PTTDeepgramService {
  private status: PTTStatus = 'idle';
  private onStatusChange: ((status: PTTStatus) => void) | null = null;
  private onTranscription: ((transcription: PTTTranscription) => void) | null = null;
  private onAudioLevel: ((level: number) => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private finalTranscript = '';

  constructor() {
    console.log('🎤 [PTT] Service initialized (Proxy Mode)');
    
    // Listen for messages from offscreen
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'PTT_TRANSCRIPTION') {
        const { transcript, isFinal } = message;
        if (isFinal) {
          this.finalTranscript += (this.finalTranscript ? ' ' : '') + transcript;
        }
        if (this.onTranscription) {
          this.onTranscription({
            text: transcript,
            isFinal,
            confidence: 1.0
          });
        }
      }
      
      if (message.type === 'PTT_AUDIO_LEVEL') {
        if (this.onAudioLevel) {
          this.onAudioLevel(message.level);
        }
      }
    });
  }

  setStatusListener(listener: (status: PTTStatus) => void): void {
    this.onStatusChange = listener;
  }

  setTranscriptionListener(listener: (transcription: PTTTranscription) => void): void {
    this.onTranscription = listener;
  }

  setAudioLevelListener(listener: (level: number) => void): void {
    this.onAudioLevel = listener;
  }

  setErrorListener(listener: (error: string) => void): void {
    this.onError = listener;
  }

  async startRecording(deepgramApiKey: string): Promise<void> {
    if (this.status === 'recording') return;

    try {
      this.finalTranscript = '';
      this.updateStatus('connecting');
      console.log('📄 [PTT] Ensuring offscreen document...');
      
      // 1. Ensure Offscreen Document Exists
      await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });

      console.log('🎤 [PTT] Requesting Offscreen Capture...');

      // 2. Start Capture
      const response = await chrome.runtime.sendMessage({
        type: 'START_PTT_CAPTURE',
        deepgramApiKey
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to start PTT capture');
      }

      this.updateStatus('recording');
      console.log('✅ [PTT] Offscreen Recording Started');
    } catch (error: any) {
      console.error('❌ [PTT] Start Failed:', error);
      this.updateStatus('error');
      if (this.onError) this.onError(error.message);
    }
  }

  async stopRecording(): Promise<string> {
    console.log('🛑 [PTT] Stopping Offscreen Capture...');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STOP_PTT_CAPTURE'
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to stop PTT capture');
      }

      this.updateStatus('idle');
      console.log(`✅ [PTT] Stopped. Final: "${response.transcript}"`);
      return response.transcript || this.finalTranscript;
    } catch (error: any) {
      console.error('❌ [PTT] Stop Failed:', error);
      this.updateStatus('idle');
      return this.finalTranscript; // Return what we have locally as fallback
    }
  }

  getStatus(): PTTStatus {
    return this.status;
  }

  getFinalTranscript(): string {
    return this.finalTranscript;
  }

  private updateStatus(status: PTTStatus): void {
    this.status = status;
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  }
}

// Export singleton instance
export const pttDeepgramService = new PTTDeepgramService();
