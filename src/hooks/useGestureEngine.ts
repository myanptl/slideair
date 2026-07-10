import { useCallback, useEffect, useRef, useState } from 'react'
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { GestureEngine, isPointingPose } from '../lib/gestures'
import type { EngineEvent, Frame, GestureName } from '../lib/gestures'

export type CameraStatus = 'idle' | 'loading' | 'running' | 'denied' | 'error'

export interface HudData {
  armed: boolean
  armProgress: number
  laser: { active: boolean; x: number; y: number }
  gesture: GestureName | 'Pointing'
  fps: number
  /** mirrored normalized landmarks of the first hand, for the skeleton overlay */
  landmarks: Array<{ x: number; y: number }>
}

const IDLE_HUD: HudData = {
  armed: false,
  armProgress: 0,
  laser: { active: false, x: 0, y: 0 },
  gesture: 'None',
  fps: 0,
  landmarks: [],
}

/**
 * Owns the camera, the MediaPipe recognizer, and the frame loop. The video
 * element is fed to MediaPipe directly; there is deliberately no per-frame
 * canvas work in this loop, it is the difference between 30fps and lag.
 * Emits engine events through `onEvent`; exposes HUD data via a subscription
 * (not React state) so the frame loop never re-renders the app.
 */
export function useGestureEngine(onEvent: (e: EngineEvent) => void) {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hudRef = useRef<HudData>(IDLE_HUD)
  const hudListeners = useRef(new Set<() => void>())
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const stopRef = useRef<(() => void) | null>(null)

  const subscribeHud = useCallback((fn: () => void) => {
    hudListeners.current.add(fn)
    return () => hudListeners.current.delete(fn)
  }, [])
  const getHud = useCallback(() => hudRef.current, [])

  const stop = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    hudRef.current = IDLE_HUD
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    if (stopRef.current) return
    setStatus('loading')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // modest resolution keeps inference fast; 60fps doubles swipe samples
        video: { width: 640, height: 480, facingMode: 'user', frameRate: { ideal: 60 } },
        audio: false,
      })
    } catch {
      setStatus('denied')
      return
    }
    try {
      const vision = await FilesetResolver.forVisionTasks('/wasm')
      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        // defaults (0.5) drop the hand during fast motion; keep tracking through blur
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.35,
      })

      const video = videoRef.current
      if (!video) throw new Error('video element missing')
      video.srcObject = stream
      await video.play()

      const engine = new GestureEngine()
      let raf = 0
      let lastVideoTime = -1
      let lastFpsTime = performance.now()
      let framesSinceFps = 0
      let fps = 0
      let cancelled = false

      const loop = () => {
        if (cancelled) return
        raf = requestAnimationFrame(loop)
        if (video.currentTime === lastVideoTime) return
        lastVideoTime = video.currentTime
        const now = performance.now()
        const result = recognizer.recognizeForVideo(video, now)

        framesSinceFps += 1
        if (now - lastFpsTime >= 1000) {
          fps = framesSinceFps
          framesSinceFps = 0
          lastFpsTime = now
        }

        const hand = result.landmarks?.[0]
        const category = result.gestures?.[0]?.[0]
        const mirrored = hand ? hand.map((p) => ({ x: 1 - p.x, y: p.y })) : []
        // mirror x so all downstream logic matches what the user sees.
        // handX is the middle FINGERTIP: a wrist flick barely moves the wrist
        // but sweeps the fingertips. handScale makes motion distance-invariant.
        const frame: Frame = {
          t: now,
          gesture: (category?.categoryName || 'None') as GestureName,
          score: category?.score ?? 0,
          handX: hand ? mirrored[12].x : null,
          handScale: hand
            ? Math.hypot(mirrored[0].x - mirrored[9].x, mirrored[0].y - mirrored[9].y)
            : 0,
          indexTip: hand ? mirrored[8] : null,
          pointing: hand ? isPointingPose(mirrored) : false,
        }
        const state = engine.step(frame)
        for (const e of state.events) onEventRef.current(e)

        hudRef.current = {
          armed: state.armed,
          armProgress: state.armProgress,
          laser: state.laser,
          gesture: frame.pointing ? 'Pointing' : frame.gesture,
          fps,
          landmarks: mirrored,
        }
        hudListeners.current.forEach((fn) => fn())
      }
      raf = requestAnimationFrame(loop)

      stopRef.current = () => {
        cancelled = true
        cancelAnimationFrame(raf)
        recognizer.close()
        stream.getTracks().forEach((t) => t.stop())
        if (video) video.srcObject = null
      }
      setStatus('running')
    } catch (err) {
      console.error('SlideAir engine failed to start', err)
      stream.getTracks().forEach((t) => t.stop())
      setStatus('error')
    }
  }, [])

  useEffect(() => () => stopRef.current?.(), [])

  return { status, start, stop, videoRef, subscribeHud, getHud }
}
