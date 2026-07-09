// Pure gesture logic. No DOM, no camera. Everything here is unit-testable.
// Coordinates are in MIRRORED normalized space (0..1, matching what the user sees).
//
// v2 notes, learned from real use:
// - Fast swipes cause motion blur; the tracker drops the hand for a few frames
//   mid-swipe. The detector must bridge short dropouts, never hard-reset on them.
// - The canned Pointing_Up classifier is too strict for natural pointing.
//   Pointing is detected geometrically from landmarks instead, with hysteresis.
// - The fist blackout gesture was removed: low value, real false positives.

export type GestureName =
  | 'None'
  | 'Closed_Fist'
  | 'Open_Palm'
  | 'Pointing_Up'
  | 'Thumb_Up'
  | 'Thumb_Down'
  | 'Victory'
  | 'ILoveYou'

export type EngineEvent = 'arm-toggle' | 'next' | 'prev'

export interface Frame {
  /** timestamp in ms */
  t: number
  gesture: GestureName
  score: number
  /** mirrored wrist x, or null when no hand is tracked this frame */
  wristX: number | null
  /** mirrored index fingertip, or null */
  indexTip: { x: number; y: number } | null
  /** geometric pointing pose, computed from landmarks via isPointingPose */
  pointing: boolean
}

export interface EngineState {
  events: EngineEvent[]
  armed: boolean
  laser: { active: boolean; x: number; y: number }
  /** 0..1 progress of the open-palm arm/disarm hold */
  armProgress: number
}

const MIN_SCORE = 0.5
const ARM_HOLD_MS = 700
/** hold cancels if the wrist drifts more than this while holding */
const HOLD_DRIFT = 0.06
/** a tracked hand is forgiven for gaps shorter than this (motion blur, flicker) */
const GAP_MS = 160

// Swipe: velocity-based. Distances are fractions of the camera width.
const SWIPE_WINDOW_MS = 260
const SWIPE_MIN_SPAN_MS = 50
/** peak horizontal velocity, in camera-widths per second */
const SWIPE_MIN_VELOCITY = 1.0
/** net displacement across the window */
const SWIPE_MIN_DISTANCE = 0.09
const SWIPE_COOLDOWN_MS = 650
/** returning the hand after a swipe moves the opposite way; block that direction longer */
const SWIPE_OPPOSITE_COOLDOWN_MS = 1300
/** the hand must calm below this velocity before another swipe can fire */
const SWIPE_REARM_VELOCITY = 0.35
/** a between-frame jump this large is a tracking glitch, not motion */
const TELEPORT_DISTANCE = 0.28

// Laser: hysteresis + smoothing.
const LASER_ON_FRAMES = 3
const LASER_OFF_MS = 280
const LASER_SMOOTHING = 0.45
/** central camera region that maps to the full slide, so small motions reach corners */
const LASER_REGION = { x0: 0.18, x1: 0.82, y0: 0.22, y1: 0.85 }

type Point = { x: number; y: number }

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Geometric pointing pose from 21 hand landmarks: index finger extended,
 * middle and ring curled. Orientation-independent, unlike the canned
 * Pointing_Up gesture, so pointing AT the screen works.
 */
export function isPointingPose(lm: Point[]): boolean {
  if (lm.length < 21) return false
  const wrist = lm[0]
  const extended = (tip: number, pip: number) =>
    dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.1
  const curled = (tip: number, pip: number) =>
    dist(lm[tip], wrist) < dist(lm[pip], wrist) * 1.05
  const indexOut = extended(8, 6)
  const middleIn = curled(12, 10)
  const ringIn = curled(16, 14)
  return indexOut && middleIn && ringIn
}

/** Fires once when `gesture` is held continuously for `holdMs` without drifting. */
export class HoldDetector {
  private readonly gesture: GestureName
  private readonly holdMs: number
  private start: number | null = null
  private startX: number | null = null
  private lastSeen = 0
  private fired = false
  progress = 0

  constructor(gesture: GestureName, holdMs: number) {
    this.gesture = gesture
    this.holdMs = holdMs
  }

  feed(frame: Frame): boolean {
    const active = frame.gesture === this.gesture && frame.score >= MIN_SCORE
    if (active) {
      if (this.start === null) {
        this.start = frame.t
        this.startX = frame.wristX
        this.fired = false
      }
      this.lastSeen = frame.t
      const drifted =
        this.startX !== null &&
        frame.wristX !== null &&
        Math.abs(frame.wristX - this.startX) > HOLD_DRIFT
      if (drifted) {
        this.start = frame.t
        this.startX = frame.wristX
        this.progress = 0
        return false
      }
      const held = frame.t - this.start
      this.progress = Math.min(held / this.holdMs, 1)
      if (held >= this.holdMs && !this.fired) {
        this.fired = true
        return true
      }
      return false
    }
    if (this.start !== null && frame.t - this.lastSeen < GAP_MS) return false
    this.start = null
    this.startX = null
    this.progress = 0
    return false
  }
}

/**
 * Velocity-based swipe detector. Returns -1 (left), 1 (right), or 0.
 * Bridges tracking dropouts shorter than GAP_MS instead of resetting,
 * because fast swipes are exactly when the tracker loses the hand.
 */
export class SwipeDetector {
  private samples: Array<{ t: number; x: number }> = []
  private lastSample = 0
  private cooldownUntil = 0
  private oppositeUntil = 0
  private lastDir: -1 | 1 = -1
  private rearmed = true

  feed(frame: Frame): -1 | 0 | 1 {
    if (frame.wristX === null) {
      // bridge short dropouts; only reset after a real absence
      if (frame.t - this.lastSample > GAP_MS) this.samples = []
      return 0
    }
    // a huge between-frame jump is a re-detection somewhere else, not motion
    const prev = this.samples[this.samples.length - 1]
    if (prev && Math.abs(frame.wristX - prev.x) > TELEPORT_DISTANCE) {
      this.samples = []
    }
    this.samples.push({ t: frame.t, x: frame.wristX })
    this.lastSample = frame.t
    const cutoff = frame.t - SWIPE_WINDOW_MS
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()

    const first = this.samples[0]
    const span = frame.t - first.t
    if (span < SWIPE_MIN_SPAN_MS) return 0

    const disp = frame.wristX - first.x
    const velocity = disp / (span / 1000)

    if (Math.abs(velocity) < SWIPE_REARM_VELOCITY) this.rearmed = true

    // confident pointing means the laser is in use; do not fire, do not reset
    if (frame.pointing) return 0

    const dir: -1 | 1 = disp > 0 ? 1 : -1
    const oppositeBlocked = dir !== this.lastDir && frame.t < this.oppositeUntil
    if (
      this.rearmed &&
      frame.t >= this.cooldownUntil &&
      !oppositeBlocked &&
      Math.abs(velocity) >= SWIPE_MIN_VELOCITY &&
      Math.abs(disp) >= SWIPE_MIN_DISTANCE
    ) {
      this.cooldownUntil = frame.t + SWIPE_COOLDOWN_MS
      this.oppositeUntil = frame.t + SWIPE_OPPOSITE_COOLDOWN_MS
      this.lastDir = dir
      this.rearmed = false
      this.samples = []
      return dir
    }
    return 0
  }
}

/**
 * Laser pointer with hysteresis and smoothing.
 * Turns on after a few consecutive pointing frames, survives short gaps,
 * maps a central camera region to the full slide, and EMA-smooths jitter.
 */
export class LaserTracker {
  private onStreak = 0
  private lastPointing = 0
  private smoothed: Point | null = null
  active = false

  feed(frame: Frame): { active: boolean; x: number; y: number } {
    if (frame.pointing && frame.indexTip) {
      this.onStreak += 1
      this.lastPointing = frame.t
      if (this.onStreak >= LASER_ON_FRAMES) this.active = true
      if (this.active) {
        const target = {
          x: clamp01((frame.indexTip.x - LASER_REGION.x0) / (LASER_REGION.x1 - LASER_REGION.x0)),
          y: clamp01((frame.indexTip.y - LASER_REGION.y0) / (LASER_REGION.y1 - LASER_REGION.y0)),
        }
        this.smoothed = this.smoothed
          ? {
              x: this.smoothed.x + (target.x - this.smoothed.x) * LASER_SMOOTHING,
              y: this.smoothed.y + (target.y - this.smoothed.y) * LASER_SMOOTHING,
            }
          : target
      }
    } else if (frame.t - this.lastPointing > LASER_OFF_MS) {
      this.active = false
      this.onStreak = 0
      this.smoothed = null
    }
    return this.active && this.smoothed
      ? { active: true, x: this.smoothed.x, y: this.smoothed.y }
      : { active: false, x: 0, y: 0 }
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * The SlideAir gesture engine.
 * Disarmed: only the open-palm arm hold is listened to.
 * Armed: swipe left = next, swipe right = previous, point = laser.
 */
export class GestureEngine {
  private armed = false
  private armHold = new HoldDetector('Open_Palm', ARM_HOLD_MS)
  private swipe = new SwipeDetector()
  private laserTracker = new LaserTracker()

  step(frame: Frame): EngineState {
    const events: EngineEvent[] = []

    if (this.armHold.feed(frame)) {
      this.armed = !this.armed
      events.push('arm-toggle')
      if (!this.armed) this.laserTracker = new LaserTracker()
    }

    let laser = { active: false, x: 0, y: 0 }
    if (this.armed) {
      const dir = this.swipe.feed(frame)
      if (dir === -1) events.push('next')
      if (dir === 1) events.push('prev')
      laser = this.laserTracker.feed(frame)
    }

    return {
      events,
      armed: this.armed,
      laser,
      armProgress: this.armHold.progress,
    }
  }
}
