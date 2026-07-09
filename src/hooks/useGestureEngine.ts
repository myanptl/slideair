import { useCallback, useEffect, useRef, useState } from 'react'
import { FaceDetector, FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { GestureEngine, isPinchPose, isPointingPose } from '../lib/gestures'
import type { EngineEvent, Frame, GestureName } from '../lib/gestures'
import { FollowCam } from '../lib/followcam'

export type CameraStatus = 'idle' | 'loading' | 'running' | 'denied' | 'error'

export interface HudData {
  armed: boolean
  armProgress: number
  laser: { active: boolean; x: number; y: number }
  gesture: GestureName | 'Pointing' | 'Pinch'
  fps: number
  followEnabled: boolean
  /** true while the follow cam is actually zoomed in */
  zoomed: boolean
  /** mirrored normalized landmarks (crop space), for the skeleton overlay */
  landmarks: Array<{ x: number; y: number }>
}

const IDLE_HUD: HudData = {
  armed: false,
  armProgress: 0,
  laser: { active: false, x: 0, y: 0 },
  gesture: 'None',
  fps: 0,
  followEnabled: false,
  zoomed: false,
  landmarks: [],
}

/** run face detection every Nth processed frame; faces move slower than hands */
const FACE_EVERY = 4
/** width of the offscreen frame MediaPipe sees; height follows the camera aspect */
const PROC_WIDTH = 640

/**
 * Owns the camera, the follow-cam crop pipeline, the MediaPipe models, and the
 * frame loop. MediaPipe always processes the CROPPED frame, so gestures keep
 * working when the presenter is far from the camera.
 * Emits engine events through `onEvent`; exposes HUD data via a subscription
 * (not React state) so the frame loop never re-renders the app.
 */
export function useGestureEngine(onEvent: (e: EngineEvent) => void) {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  /** the processed (cropped) frame, drawn by the loop; the HUD renders from it */
  const procRef = useRef<HTMLCanvasElement | null>(null)
  const followRef = useRef(new FollowCam())
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

  const toggleFollow = useCallback(() => {
    followRef.current.toggle()
  }, [])

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
        // high-res source keeps the crop sharp; 60fps doubles swipe samples
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
          frameRate: { ideal: 60 },
        },
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
      const faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
      })

      const video = videoRef.current
      if (!video) throw new Error('video element missing')
      video.srcObject = stream
      await video.play()

      const proc = document.createElement('canvas')
      proc.width = PROC_WIDTH
      proc.height = Math.round((PROC_WIDTH * video.videoHeight) / video.videoWidth) || 480
      const procCtx = proc.getContext('2d', { willReadFrequently: false })
      if (!procCtx) throw new Error('canvas 2d context unavailable')
      procRef.current = proc

      const engine = new GestureEngine()
      const follow = followRef.current
      let raf = 0
      let lastVideoTime = -1
      let lastFpsTime = performance.now()
      let framesSinceFps = 0
      let fps = 0
      let frameCount = 0
      let cancelled = false

      const loop = () => {
        if (cancelled) return
        raf = requestAnimationFrame(loop)
        if (video.currentTime === lastVideoTime) return
        lastVideoTime = video.currentTime
        const now = performance.now()
        frameCount += 1

        // 1. draw the current crop into the processing frame
        const box = follow.box
        const vw = video.videoWidth
        const vh = video.videoHeight
        procCtx.drawImage(
          video,
          box.x * vw, box.y * vh, box.w * vw, box.h * vh,
          0, 0, proc.width, proc.height,
        )

        // 2. gestures on the cropped frame
        const result = recognizer.recognizeForVideo(proc, now)

        // 3. face detection (cheap model, every few frames) steers the crop
        if (frameCount % FACE_EVERY === 0) {
          const faces = faceDetector.detectForVideo(proc, now)
          const bb = faces.detections?.[0]?.boundingBox
          follow.update(
            now,
            bb
              ? {
                  x: bb.originX / proc.width,
                  y: bb.originY / proc.height,
                  w: bb.width / proc.width,
                  h: bb.height / proc.height,
                }
              : null,
          )
        } else {
          follow.update(now, null)
        }

        framesSinceFps += 1
        if (now - lastFpsTime >= 1000) {
          fps = framesSinceFps
          framesSinceFps = 0
          lastFpsTime = now
        }

        const hand = result.landmarks?.[0]
        const category = result.gestures?.[0]?.[0]
        const mirrored = hand ? hand.map((p) => ({ x: 1 - p.x, y: p.y })) : []
        // mirror x so all downstream logic matches what the user sees
        const frame: Frame = {
          t: now,
          gesture: (category?.categoryName || 'None') as GestureName,
          score: category?.score ?? 0,
          wristX: hand ? mirrored[0].x : null,
          indexTip: hand ? mirrored[8] : null,
          pointing: hand ? isPointingPose(mirrored) : false,
          pinching: hand ? isPinchPose(mirrored) : false,
        }
        const state = engine.step(frame)
        for (const e of state.events) {
          if (e === 'follow-toggle') follow.toggle()
          onEventRef.current(e)
        }

        hudRef.current = {
          armed: state.armed,
          armProgress: state.armProgress,
          laser: state.laser,
          gesture: frame.pinching ? 'Pinch' : frame.pointing ? 'Pointing' : frame.gesture,
          fps,
          followEnabled: follow.enabled,
          zoomed: follow.zoomed,
          landmarks: mirrored,
        }
        hudListeners.current.forEach((fn) => fn())
      }
      raf = requestAnimationFrame(loop)

      stopRef.current = () => {
        cancelled = true
        cancelAnimationFrame(raf)
        recognizer.close()
        faceDetector.close()
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

  return { status, start, stop, videoRef, procRef, subscribeHud, getHud, toggleFollow }
}
