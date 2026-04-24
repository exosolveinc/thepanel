/**
 * useDeepgramSTT — shared speech-to-text hook used by LiveVoicePanel + HMVoicePanel.
 *
 * Primary path: backend WebSocket proxy → Deepgram nova-2 (linear16 PCM via AudioWorklet).
 * Fallback: Web Speech API (browser-native), engaged automatically if:
 *   - Deepgram WS fails to connect after `maxWsRetries` attempts
 *   - No transcript text received from Deepgram for `noTextFallbackMs`
 *   - getUserMedia is denied (no audio stream → can't use Deepgram)
 *
 * The consumer supplies an `onUtterance(text)` callback fired once per
 * speech-final / utterance-end event (after debouncing).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const STT_WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/stt`

const SpeechRecognitionClass = (
  (window as unknown as Record<string, unknown>).SpeechRecognition ??
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition
) as { new(): SpeechRecognition } | undefined

export type STTMode = 'deepgram' | 'webspeech'

export interface STTOptions {
  onUtterance: (text: string) => void
  logTag?: string
  flushDebounceMs?: number
  maxWsRetries?: number
  noTextFallbackMs?: number
}

export interface STTState {
  isRecording: boolean
  audioActive: boolean
  analyserNode: AnalyserNode | null
  transcriptLog: string[]
  stableChunk: string
  interimChunk: string
  permError: string
  notice: string
  mode: STTMode
}

export interface STTControls {
  start: () => Promise<void>
  stop: () => void
  toggle: () => void
  dismissNotice: () => void
  clearTranscript: () => void
}

export function useDeepgramSTT({
  onUtterance,
  logTag = 'STT',
  flushDebounceMs = 600,
  maxWsRetries = 3,
  noTextFallbackMs = 60_000,
}: STTOptions): STTState & STTControls {
  const [isRecording, setIsRecording]   = useState(false)
  const [audioActive, setAudioActive]   = useState(false)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [transcriptLog, setTranscriptLog] = useState<string[]>([])
  const [stableChunk, setStableChunk]   = useState('')
  const [interimChunk, setInterimChunk] = useState('')
  const [permError, setPermError]       = useState('')
  const [notice, setNotice]             = useState('')
  const [mode, setMode]                 = useState<STTMode>('deepgram')

  const streamRef          = useRef<MediaStream | null>(null)
  const audioCtxRef        = useRef<AudioContext | null>(null)
  const stopPollRef        = useRef<(() => void) | null>(null)
  const wsRef              = useRef<WebSocket | null>(null)
  const workletNodeRef     = useRef<AudioWorkletNode | null>(null)
  const recognitionRef     = useRef<SpeechRecognition | null>(null)
  const shouldRunRef       = useRef(false)
  const wsRetryCountRef    = useRef(0)
  const dgFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalBufRef        = useRef('')
  const debounceTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioLevelRef      = useRef(0)
  const modeRef            = useRef<STTMode>('deepgram')
  const onUtteranceRef     = useRef(onUtterance)

  useEffect(() => { onUtteranceRef.current = onUtterance }, [onUtterance])

  const cancelDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  const startLevelPoll = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    const poll = () => {
      raf = requestAnimationFrame(poll)
      analyser.getByteFrequencyData(data)
      const max = Math.max(...data)
      audioLevelRef.current = audioLevelRef.current * 0.8 + max * 0.2
      setAudioActive(audioLevelRef.current > 18)
    }
    poll()
    return () => cancelAnimationFrame(raf)
  }, [])

  const flushBuffer = useCallback(() => {
    cancelDebounce()
    const utterance = finalBufRef.current.trim()
    if (!utterance) return
    finalBufRef.current = ''
    setStableChunk('')
    setInterimChunk('')
    setTranscriptLog(prev => [...prev, utterance])
    onUtteranceRef.current(utterance)
  }, [cancelDebounce])

  /* ─── Web Speech API (fallback) ────────────────────────────── */
  const startWebSpeech = useCallback(() => {
    if (!SpeechRecognitionClass || !shouldRunRef.current) return

    const recognition = new SpeechRecognitionClass()
    recognitionRef.current = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    // onspeechstart isn't in the standard TS DOM lib but exists in Chrome
    ;(recognition as unknown as { onspeechstart: () => void }).onspeechstart = () => cancelDebounce()

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += t
        else interim += t
      }
      if (finalText.trim()) {
        finalBufRef.current = (finalBufRef.current + ' ' + finalText).trim()
        setStableChunk(finalBufRef.current)
        setInterimChunk('')
        cancelDebounce()
        debounceTimerRef.current = setTimeout(flushBuffer, flushDebounceMs)
      } else {
        setInterimChunk(interim)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        setPermError(
          'Microphone blocked at the OS level. Go to: macOS System Settings → Privacy & Security → Microphone → enable your browser. Then reload this page.'
        )
        shouldRunRef.current = false
        setIsRecording(false)
      }
    }

    recognition.onend = () => {
      if (finalBufRef.current.trim()) flushBuffer()
      if (shouldRunRef.current) {
        try { recognition.start() } catch { /* ignore */ }
      }
    }

    try { recognition.start() } catch {
      setPermError('Speech recognition not available in this browser.')
    }
  }, [cancelDebounce, flushBuffer, flushDebounceMs])

  // Refs to break circular deps between switchToFallback ↔ connectWS
  const startWebSpeechRef = useRef(startWebSpeech)
  useEffect(() => { startWebSpeechRef.current = startWebSpeech }, [startWebSpeech])

  const switchToFallback = useCallback((reason: string) => {
    modeRef.current = 'webspeech'
    setMode('webspeech')
    setNotice(`Deepgram unavailable: ${reason}. Using browser speech recognition instead.`)
    try { workletNodeRef.current?.disconnect() } catch { /* ignore */ }
    workletNodeRef.current = null
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    if (dgFallbackTimerRef.current) {
      clearTimeout(dgFallbackTimerRef.current)
      dgFallbackTimerRef.current = null
    }
    if (SpeechRecognitionClass && shouldRunRef.current) {
      startWebSpeechRef.current()
    } else if (!SpeechRecognitionClass) {
      setPermError('Deepgram failed and Web Speech API not supported. Use Chrome or Edge.')
      shouldRunRef.current = false
      setIsRecording(false)
    }
  }, [])

  const switchToFallbackRef = useRef(switchToFallback)
  useEffect(() => { switchToFallbackRef.current = switchToFallback }, [switchToFallback])

  /* ─── Deepgram WebSocket (primary) ─────────────────────────── */
  const armNoTextTimer = useCallback((ws: WebSocket) => {
    if (dgFallbackTimerRef.current) clearTimeout(dgFallbackTimerRef.current)
    dgFallbackTimerRef.current = setTimeout(() => {
      console.warn(`[${logTag}] No Deepgram text for ${noTextFallbackMs / 1000}s — switching to Web Speech`)
      try { ws.close() } catch { /* ignore */ }
      switchToFallbackRef.current(`No transcription received for ${noTextFallbackMs / 1000} seconds`)
    }, noTextFallbackMs)
  }, [logTag, noTextFallbackMs])

  const connectWS = useCallback((stream: MediaStream) => {
    if (!shouldRunRef.current) return
    const ws = new WebSocket(STT_WS_URL)
    wsRef.current = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = async () => {
      armNoTextTimer(ws)
      wsRetryCountRef.current = 0

      const ctx = audioCtxRef.current
      if (!ctx) return
      try { await ctx.audioWorklet.addModule('/pcm-processor.js') } catch { /* already loaded */ }
      const workletNode = new AudioWorkletNode(ctx, 'pcm-processor')
      workletNodeRef.current = workletNode
      const source = ctx.createMediaStreamSource(stream)
      source.connect(workletNode)
      workletNode.port.onmessage = (e: MessageEvent) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer)
      }
    }

    ws.onmessage = e => {
      if (typeof e.data !== 'string') return
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'error') {
        const errMsg = (msg.message as string) || 'Unknown Deepgram error'
        try { ws.close() } catch { /* ignore */ }
        switchToFallbackRef.current(errMsg)
        return
      }

      if (msg.type === 'SpeechStarted') {
        cancelDebounce()
      } else if (msg.type === 'Results') {
        const alt = (msg.channel as { alternatives: { transcript: string }[] })?.alternatives?.[0]
        const text = alt?.transcript ?? ''
        const isFinal = msg.is_final as boolean
        const speechFinal = msg.speech_final as boolean

        if (text.trim()) armNoTextTimer(ws)

        if (!isFinal) {
          setInterimChunk(text)
        } else {
          setInterimChunk('')
          if (text.trim()) finalBufRef.current = (finalBufRef.current + ' ' + text).trim()
          setStableChunk(finalBufRef.current)
          if (speechFinal) {
            cancelDebounce()
            debounceTimerRef.current = setTimeout(flushBuffer, flushDebounceMs)
          }
        }
      } else if (msg.type === 'UtteranceEnd') {
        flushBuffer()
      }
    }

    ws.onerror = err => { console.error(`[${logTag}] WebSocket error:`, err) }
    ws.onclose = () => {
      if (!shouldRunRef.current) return
      if (modeRef.current === 'webspeech') return
      setInterimChunk('')
      if (wsRetryCountRef.current >= maxWsRetries) {
        switchToFallbackRef.current('Connection lost after retries')
        return
      }
      const delay = Math.min(500 * Math.pow(2, wsRetryCountRef.current), 4000)
      wsRetryCountRef.current++
      setTimeout(() => connectWS(stream), delay)
    }
  }, [armNoTextTimer, cancelDebounce, flushBuffer, flushDebounceMs, logTag, maxWsRetries])

  /* ─── Public controls ──────────────────────────────────────── */
  const stop = useCallback(() => {
    shouldRunRef.current = false
    cancelDebounce()
    if (dgFallbackTimerRef.current) {
      clearTimeout(dgFallbackTimerRef.current)
      dgFallbackTimerRef.current = null
    }
    try { workletNodeRef.current?.disconnect() } catch { /* ignore */ }
    workletNodeRef.current = null
    try { wsRef.current?.close() } catch { /* ignore */ }
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
    recognitionRef.current = null
    wsRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    stopPollRef.current?.()
    audioCtxRef.current?.close()
    streamRef.current = null
    audioCtxRef.current = null
    stopPollRef.current = null
    finalBufRef.current = ''
    setIsRecording(false)
    setAudioActive(false)
    setAnalyserNode(null)
    setStableChunk('')
    setInterimChunk('')
  }, [cancelDebounce])

  const start = useCallback(async () => {
    if (shouldRunRef.current) return
    shouldRunRef.current = true
    setIsRecording(true)
    setPermError('')
    setNotice('')
    finalBufRef.current = ''
    wsRetryCountRef.current = 0

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      // getUserMedia denied — fall through to Web Speech
    }

    if (stream) {
      streamRef.current = stream
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)
      setAnalyserNode(analyser)
      stopPollRef.current?.()
      stopPollRef.current = startLevelPoll(analyser)

      modeRef.current = 'deepgram'
      setMode('deepgram')
      connectWS(stream)
    } else if (SpeechRecognitionClass) {
      modeRef.current = 'webspeech'
      setMode('webspeech')
      setNotice('Mic stream unavailable for Deepgram. Using browser speech recognition (no visualizer).')
      startWebSpeechRef.current()
    } else {
      setPermError(
        'Microphone access denied. Check: (1) Browser address bar mic icon, ' +
        '(2) macOS System Settings → Privacy & Security → Microphone → enable your browser, ' +
        '(3) If in VS Code browser, use Chrome instead.'
      )
      shouldRunRef.current = false
      setIsRecording(false)
    }
  }, [connectWS, startLevelPoll])

  const toggle = useCallback(() => {
    if (shouldRunRef.current) stop()
    else start()
  }, [start, stop])

  const dismissNotice = useCallback(() => setNotice(''), [])
  const clearTranscript = useCallback(() => {
    setTranscriptLog([])
    setStableChunk('')
    setInterimChunk('')
  }, [])

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop])

  return {
    isRecording, audioActive, analyserNode,
    transcriptLog, stableChunk, interimChunk,
    permError, notice, mode,
    start, stop, toggle, dismissNotice, clearTranscript,
  }
}
