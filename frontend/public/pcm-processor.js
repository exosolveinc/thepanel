/**
 * AudioWorklet processor: downsample to 16kHz, buffer ~100ms, send as Int16 PCM.
 * Reduces WebSocket messages from ~375/sec to ~10/sec and data from 96KB/s to ~3.2KB/s.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = []
    this._bufferSamples = 0
    // Send every ~100ms worth of 16kHz audio = 1600 samples = 3200 bytes
    this._flushAt = 1600
    // Downsample ratio: sampleRate (48000) → 16000
    this._ratio = Math.round(sampleRate / 16000)
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true

    const float32 = input[0]
    // Downsample by picking every Nth sample
    for (let i = 0; i < float32.length; i += this._ratio) {
      const s = Math.max(-1, Math.min(1, float32[i]))
      this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF)
      this._bufferSamples++
    }

    if (this._bufferSamples >= this._flushAt) {
      const int16 = new Int16Array(this._buffer)
      this.port.postMessage(int16.buffer, [int16.buffer])
      this._buffer = []
      this._bufferSamples = 0
    }

    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
