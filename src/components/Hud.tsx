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
  visible: boolean
}

export function Hud({ subscribe, getHud, videoRef, visible }: Props) {
  const hud = useSyncExternalStore(subscribe, getHud)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)
    if (hud.landmarks.length === 0) return
    ctx.strokeStyle = hud.armed ? 'rgba(232,195,74,0.9)' : 'rgba(242,239,228,0.5)'
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
  }, [hud])

  const holding = Math.max(hud.armProgress, hud.blackoutProgress)

  return (
    <div className={`hud ${visible ? '' : 'hud-hidden'}`}>
      <div className="hud-video-wrap">
        {/* the video element must stay mounted; the engine streams into it */}
        <video ref={videoRef} className="hud-video" muted playsInline />
        <canvas ref={canvasRef} className="hud-canvas" width={208} height={156} />
        {holding > 0 && holding < 1 && (
          <div className="hud-hold" style={{ width: `${holding * 100}%` }} />
        )}
      </div>
      <div className="hud-row">
        <span className={`chip ${hud.armed ? 'chip-armed' : 'chip-idle'}`}>
          {hud.armed ? 'Armed' : 'Disarmed'}
        </span>
        <span className="hud-meta">
          {hud.gesture !== 'None' ? hud.gesture.replace(/_/g, ' ') : ' '}
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
