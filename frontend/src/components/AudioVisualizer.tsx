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

    const ctx = canvas.getContext('2d')!

    // Idle flat-line when not active
    if (!analyser || !active) {
      cancelAnimationFrame(rafRef.current)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = 'rgba(99,102,241,0.25)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, canvas.height / 2)
      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
      return
    }

    analyser.fftSize = 128
    const bufLen  = analyser.frequencyBinCount   // 64
    const data    = new Uint8Array(bufLen)
    const W       = canvas.width
    const H       = canvas.height
    const barW    = W / bufLen

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(data)
      ctx.clearRect(0, 0, W, H)

      for (let i = 0; i < bufLen; i++) {
        const norm      = data[i] / 255                      // 0–1
        const barH      = Math.max(2, norm * H)
        const hue       = 230 + norm * 50                    // indigo → violet
        const lightness = 55 + norm * 20
        ctx.fillStyle   = `hsla(${hue},75%,${lightness}%,${0.5 + norm * 0.5})`
        ctx.beginPath()
        ctx.roundRect(
          i * barW + 0.5,
          (H - barH) / 2,
          barW - 1,
          barH,
          2,
        )
        ctx.fill()
      }
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser, active])

  return (
    <canvas
      ref={canvasRef}
      width={560}
      height={height}
      className="w-full"
      style={{ height }}
    />
  )
}
