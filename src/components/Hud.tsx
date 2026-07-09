import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { HudData } from '../hooks/useGestureEngine'

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9],
  [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

interface Props {
  subscribe: (fn: () => void) => () => void
  getHud: () => HudData
  videoRef: React.RefObject<HTMLVideoElement | null>
  procRef: React.RefObject<HTMLCanvasElement | null>
  visible: boolean
}

export function Hud({ subscribe, getHud, videoRef, procRef, visible }: Props) {
  const hud = useSyncExternalStore(subscribe, getHud)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const proc = procRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // the preview shows what MediaPipe sees: the follow-cam crop, mirrored
    if (proc && proc.width > 0) {
      const aspect = proc.height / proc.width
      const targetH = Math.round(canvas.width * aspect)
      if (canvas.height !== targetH) canvas.height = targetH
      ctx.save()
      ctx.scale(-1, 1)
      ctx.drawImage(proc, -canvas.width, 0, canvas.width, canvas.height)
      ctx.restore()
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    if (hud.landmarks.length === 0) return
    const { width, height } = canvas
    ctx.strokeStyle = hud.armed ? 'rgba(232,195,74,0.9)' : 'rgba(242,239,228,0.6)'
    ctx.lineWidth = 2
    for (const [a, b] of CONNECTIONS) {
      const p = hud.landmarks[a]
      const q = hud.landmarks[b]
      ctx.beginPath()
      ctx.moveTo(p.x * width, p.y * height)
      ctx.lineTo(q.x * width, q.y * height)
      ctx.stroke()
    }
    ctx.fillStyle = ctx.strokeStyle
    for (const p of hud.landmarks) {
      ctx.beginPath()
      ctx.arc(p.x * width, p.y * height, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [hud, procRef])

  return (
    <div className={`hud ${visible ? '' : 'hud-hidden'}`}>
      <div className="hud-video-wrap">
        {/* the engine streams into this element; the canvas is the visible preview */}
        <video ref={videoRef} className="hud-source" muted playsInline />
        <canvas ref={canvasRef} className="hud-view" width={208} height={117} />
        {hud.armProgress > 0 && hud.armProgress < 1 && (
          <div className="hud-hold" style={{ width: `${hud.armProgress * 100}%` }} />
        )}
      </div>
      <div className="hud-row">
        <span className={`chip ${hud.armed ? 'chip-armed' : 'chip-idle'}`}>
          {hud.armed ? 'Armed' : 'Disarmed'}
        </span>
        {hud.followEnabled && (
          <span className={`chip ${hud.zoomed ? 'chip-armed' : 'chip-idle'}`}>Follow</span>
        )}
        <span className="hud-meta">
          {hud.gesture !== 'None' ? hud.gesture.replace(/_/g, ' ') : ' '}
        </span>
        <span className="hud-meta hud-fps">{hud.fps > 0 ? `${hud.fps} fps` : ''}</span>
      </div>
    </div>
  )
}

export function Laser({ subscribe, getHud }: Pick<Props, 'subscribe' | 'getHud'>) {
  const hud = useSyncExternalStore(subscribe, getHud)
  if (!hud.laser.active) return null
  return (
    <div
      className="laser"
      style={{ left: `${hud.laser.x * 100}%`, top: `${hud.laser.y * 100}%` }}
    />
  )
}
