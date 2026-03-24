import { useRef, useEffect } from 'react'

interface Props {
  analyser: AnalyserNode | null
  active: boolean
  height?: number
}

export default function AudioVisualizer({ analyser, active, height = 40 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Cancel any running loop BEFORE doing anything else — prevents double-loops
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Scale canvas to device pixel ratio so it's sharp on Retina / HiDPI screens
    const dpr  = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth || 560
    const cssH = height
    canvas.width  = cssW * dpr
    canvas.height = cssH * dpr
    ctx.scale(dpr, dpr)

    if (!analyser || !active) {
      ctx.clearRect(0, 0, cssW, cssH)
      ctx.strokeStyle = 'rgba(99,102,241,0.25)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, cssH / 2)
      ctx.lineTo(cssW, cssH / 2)
      ctx.stroke()
      return
    }

    analyser.fftSize = 128
    const bufLen = analyser.frequencyBinCount   // 64
    const data   = new Uint8Array(bufLen)
    const barW   = cssW / bufLen

    // Detect whether the browser supports ctx.roundRect (Chrome 99+, Firefox 112+; not all Safari)
    const hasRoundRect = typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === 'function'

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(data)
      ctx.clearRect(0, 0, cssW, cssH)

      for (let i = 0; i < bufLen; i++) {
        const norm      = data[i] / 255
        const barH      = Math.max(2, norm * cssH)
        const hue       = 230 + norm * 50
        const lightness = 55 + norm * 20
        ctx.fillStyle   = `hsla(${hue},75%,${lightness}%,${0.5 + norm * 0.5})`

        const x = i * barW + 0.5
        const y = (cssH - barH) / 2
        const w = Math.max(1, barW - 1)

        ctx.beginPath()
        if (hasRoundRect) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(ctx as any).roundRect(x, y, w, barH, 2)
        } else {
          ctx.rect(x, y, w, barH)
        }
        ctx.fill()
      }
    }

    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [analyser, active, height])

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
    />
  )
}
