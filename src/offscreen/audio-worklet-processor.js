/**
 * AudioWorklet Processor for Deepgram Live Transcription
 *
 * Modern replacement for deprecated ScriptProcessorNode.
 * Runs on the audio rendering thread for better performance and lower latency.
 *
 * This processor:
 * 1. Receives audio at native sample rate (typically 48kHz from tabCapture)
 * 2. Downsamples to 16kHz (Deepgram's optimal rate)
 * 3. Converts Float32 to PCM 16-bit
 * 4. Buffers and sends chunks to main thread via MessagePort
 * 5. Calculates audio level for monitoring
 */

class DeepgramAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Configuration
    this.targetSampleRate = 16000; // Deepgram's optimal rate
    this.bufferSize = 4096; // Number of samples to buffer before sending
    this.buffer = []; // Accumulates PCM16 samples
    this.frameCount = 0;
    this.audioChunksSent = 0;

    // Get native sample rate from options
    this.nativeSampleRate = options.processorOptions?.sampleRate || 48000;
    this.source = options.processorOptions?.source || 'unknown'; // 'agent' or 'caller'
    this.downsampleRatio = Math.round(this.nativeSampleRate / this.targetSampleRate);

    console.log(`[AudioWorklet] Initialized for ${this.source}: ${this.nativeSampleRate}Hz → ${this.targetSampleRate}Hz`);

    // Handle messages from main thread
    this.port.onmessage = (event) => {
      const { command } = event.data;

      switch (command) {
        case 'clear':
          this.buffer = [];
          console.log('[AudioWorklet] Buffer cleared');
          break;
        case 'pause':
          this.paused = true;
          console.log('[AudioWorklet] Paused');
          break;
        case 'resume':
          this.paused = false;
          console.log('[AudioWorklet] Resumed');
          break;
      }
    };

    this.paused = false;
  }

  /**
   * Process audio frames (called by Web Audio API)
   *
   * @param {Float32Array[][]} inputs - Input audio data
   * @param {Float32Array[][]} outputs - Output audio data (unused)
   * @param {Object} parameters - Audio parameters (unused)
   * @returns {boolean} - true to keep processor alive
   */
  process(inputs, outputs, parameters) {
    if (this.paused) {
      return true; // Keep processor alive but don't process
    }

    const input = inputs[0];
    const channelData = input[0]; // Take first channel (Mono mix from merger)

    if (!channelData || channelData.length === 0) {
      return true;
    }

    // Downsample to 16kHz (Mono)
    const downsampledLength = Math.floor(channelData.length / this.downsampleRatio);
    const downsampled = new Float32Array(downsampledLength);

    for (let i = 0; i < downsampledLength; i++) {
        downsampled[i] = channelData[i * this.downsampleRatio];
    }

    // Convert Float32 to PCM 16-bit
    const pcm16 = this.float32ToPcm16(downsampled);

    // Add to buffer
    for (let i = 0; i < pcm16.length; i++) {
      this.buffer.push(pcm16[i]);
    }

    // Send buffered audio when we have enough samples
    if (this.buffer.length >= this.bufferSize) {
      const toSend = this.buffer.splice(0, this.bufferSize);
      const pcmArray = new Int16Array(toSend);

      // Calculate audio level (RMS)
      const audioLevel = this.calculateAudioLevel(downsampled);

      // Send to main thread
      this.port.postMessage({
        command: 'audio',
        buffer: pcmArray,
        audioLevel: audioLevel,
        sampleCount: pcmArray.length,
        chunkNumber: this.audioChunksSent,
        source: this.source // Identify which stream this is (agent/caller)
      });

      this.audioChunksSent++;

      // Log every 100 chunks (~6-7 seconds)
      if (this.audioChunksSent % 100 === 0) {
        this.port.postMessage({
          command: 'stats',
          chunksS: this.audioChunksSent,
          bufferSize: this.buffer.length
        });
      }
    }

    this.frameCount++;
    return true; // Keep processor alive
  }

  /**
   * Convert Float32 audio samples to PCM 16-bit integer
   *
   * @param {Float32Array} float32Array - Audio samples in range [-1.0, 1.0]
   * @returns {Int16Array} - PCM 16-bit samples
   */
  float32ToPcm16(float32Array) {
    const pcm16 = new Int16Array(float32Array.length);

    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to [-1, 1] to prevent clipping
      const s = Math.max(-1, Math.min(1, float32Array[i]));

      // Convert to 16-bit signed integer
      // -1.0 → -32768, +1.0 → +32767
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return pcm16;
  }

  /**
   * Calculate RMS audio level as percentage (0-100)
   *
   * @param {Float32Array} samples - Audio samples
   * @returns {number} - Audio level (0-100)
   */
  calculateAudioLevel(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    return Math.min(100, Math.round(rms * 200)); // Scale to 0-100
  }
}

// Register the processor with Web Audio API
registerProcessor('deepgram-audio-processor', DeepgramAudioProcessor);
