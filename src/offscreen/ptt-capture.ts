// ============================================================================
// PTT CAPTURE SETUP (SANDBOX MODE)
// ============================================================================

let pttSocket: WebSocket | null = null
let pttStream: MediaStream | null = null
let pttProcessor: ScriptProcessorNode | null = null
let pttContext: AudioContext | null = null
let pttFinalTranscript = ''



function remoteLog(msg: string, data?: any) {
    const text = `[OFFSCREEN] ${msg} ${data ? JSON.stringify(data) : ''}`;
    console.log(text);
    chrome.runtime.sendMessage({
        type: 'LOG_FORWARD',
        message: text,
        timestamp: Date.now()
    }).catch(() => {});
}

export async function startPTTCapture(apiKey: string) {
    remoteLog('🎤 Starting PTT Capture...');
    pttFinalTranscript = ''

    try {
        // 1. Get Mic Access
        pttStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 16000
            }
        })

        // 2. Setup Audio Context
        pttContext = new AudioContext({ sampleRate: 16000 })
        const source = pttContext.createMediaStreamSource(pttStream)
        pttProcessor = pttContext.createScriptProcessor(4096, 1, 1)

        pttProcessor.onaudioprocess = (e) => {
            if (!pttSocket || pttSocket.readyState !== WebSocket.OPEN) return

            const inputData = e.inputBuffer.getChannelData(0)
            
            // Calculate Audio Level for UI
            let sum = 0
            for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i]
            }
            const rms = Math.sqrt(sum / inputData.length)
            const audioLevel = Math.min(100, Math.round(rms * 200))

            // Convert and Send
            const int16Array = new Int16Array(inputData.length)
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]))
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
            }
            
            pttSocket.send(int16Array)

            // Send level to sidepanel
            chrome.runtime.sendMessage({
                type: 'PTT_AUDIO_LEVEL',
                level: audioLevel
            }).catch(() => {})
        }

        source.connect(pttProcessor)
        pttProcessor.connect(pttContext.destination)

        // 3. Connect Deepgram
        await connectPTTSocket(apiKey)

    } catch (err: any) {
        remoteLog('❌ PTT Start Failed:', err?.message || err)
        stopPTTCapture()
        throw err
    }
}

async function connectPTTSocket(apiKey: string) {
    const params = new URLSearchParams({
        model: 'nova-3',
        language: 'en-US',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        interim_results: 'true',
        smart_format: 'true',
        punctuate: 'true',
    })

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`
    
    return new Promise<void>((resolve, reject) => {
        pttSocket = new WebSocket(wsUrl, ['token', apiKey])

        pttSocket.onopen = () => {
            remoteLog('✅ Socket Connected');
            resolve()
        }

        pttSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
                    const alt = data.channel.alternatives[0]
                    const transcript = alt.transcript
                    const isFinal = data.is_final

                    if (transcript) {
                        remoteLog(`📝 Transcription: ${transcript} (Final: ${isFinal})`);
                        if (isFinal) {
                            pttFinalTranscript += (pttFinalTranscript ? ' ' : '') + transcript
                        }
                        
                        // Send to Sidepanel
                        chrome.runtime.sendMessage({
                            type: 'PTT_TRANSCRIPTION',
                            transcript: transcript,
                            isFinal: isFinal
                        }).catch(() => {})
                    }
                }
            } catch (err) {
                remoteLog('❌ Parse Error:', err)
            }
        }

        pttSocket.onerror = (err) => {
            remoteLog('❌ Socket Error:', err)
            reject(err)
        }

        pttSocket.onclose = () => {
            remoteLog('🔌 Socket Closed')
        }
    })
}

export async function stopPTTCapture() {
    remoteLog('🛑 Stopping Capture...')

    if (pttSocket) {
        pttSocket.close()
        pttSocket = null
    }

    if (pttProcessor) {
        pttProcessor.disconnect()
        pttProcessor = null
    }

    if (pttContext) {
        pttContext.close()
        pttContext = null
    }

    if (pttStream) {
        pttStream.getTracks().forEach(t => t.stop())
        pttStream = null
    }
    
    return pttFinalTranscript.trim()
}
