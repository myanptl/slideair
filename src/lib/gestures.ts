// Pure gesture logic. No DOM, no camera. Everything here is unit-testable.
// Coordinates are in MIRRORED normalized space (0..1, matching what the user sees).

export type GestureName =
  | 'None'
  | 'Closed_Fist'
  | 'Open_Palm'
  | 'Pointing_Up'
  | 'Thumb_Up'
  | 'Thumb_Down'
  | 'Victory'
  | 'ILoveYou'

export type EngineEvent = 'arm-toggle' | 'next' | 'prev' | 'blackout-toggle'

export interface Frame {
  /** timestamp in ms */
  t: number
  gesture: GestureName
  score: number
  /** mirrored wrist x, or null when no hand */
  wristX: number | null
  /** mirrored index fingertip, or null */
  indexTip: { x: number; y: number } | null
}

export interface EngineState {
  events: EngineEvent[]
  armed: boolean
  laser: { active: boolean; x: number; y: number }
  /** 0..1 progress of the open-palm arm/disarm hold */
  armProgress: number
  /** 0..1 progress of the closed-fist blackout hold */
  blackoutProgress: number
}

const MIN_SCORE = 0.55
const ARM_HOLD_MS = 700
const BLACKOUT_HOLD_MS = 600
/** hold cancels if the wrist drifts more than this while holding */
const HOLD_DRIFT = 0.06
const SWIPE_WINDOW_MS = 350
const SWIPE_DISTANCE = 0.2
const SWIPE_COOLDOWN_MS = 900
/** a hold gesture is forgiven for gaps shorter than this (model flicker) */
const FLICKER_MS = 150

/** Fires once when `gesture` is held continuously for `holdMs` without drifting. */
export class HoldDetector {
  private start: number | null = null
  private startX: number | null = null
  private lastSeen = 0
  private fired = false
  progress = 0

  private readonly gesture: GestureName
  private readonly holdMs: number

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
    // tolerate model flicker: keep the hold alive across short gaps
    if (this.start !== null && frame.t - this.lastSeen < FLICKER_MS) return false
    this.start = null
    this.startX = null
    this.progress = 0
    return false
  }
}

/** Detects a fast horizontal swipe of the wrist. Returns -1 (left), 1 (right), or 0. */
export class SwipeDetector {
  private samples: Array<{ t: number; x: number }> = []
  private cooldownUntil = 0

  feed(frame: Frame): -1 | 0 | 1 {
    if (frame.wristX === null) {
      this.samples = []
      return 0
    }
    // swipes are made with an open palm or a relaxed hand, never while pointing
    if (frame.gesture === 'Pointing_Up') {
      this.samples = []
      return 0
    }
    this.samples.push({ t: frame.t, x: frame.wristX })
    const cutoff = frame.t - SWIPE_WINDOW_MS
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()
    if (frame.t < this.cooldownUntil || this.samples.length < 3) return 0

    const first = this.samples[0]
    const dx = frame.wristX - first.x
    if (Math.abs(dx) < SWIPE_DISTANCE) return 0

    // direction must be consistent: no sample may backtrack past the start
    const dir = dx > 0 ? 1 : -1
    for (const s of this.samples) {
      if ((s.x - first.x) * dir < -0.03) return 0
    }
    this.cooldownUntil = frame.t + SWIPE_COOLDOWN_MS
    this.samples = []
    return dir as -1 | 1
  }
}

/**
 * The SlideAir gesture engine.
 * Disarmed: only the open-palm arm hold is listened to.
 * Armed: swipe left = next, swipe right = previous,
 *        point up = laser, closed-fist hold = blackout.
 */
export class GestureEngine {
  private armed = false
  private armHold = new HoldDetector('Open_Palm', ARM_HOLD_MS)
  private blackoutHold = new HoldDetector('Closed_Fist', BLACKOUT_HOLD_MS)
  private swipe = new SwipeDetector()

  step(frame: Frame): EngineState {
    const events: EngineEvent[] = []

    if (this.armHold.feed(frame)) {
      this.armed = !this.armed
      events.push('arm-toggle')
    }

    let laser = { active: false, x: 0, y: 0 }
    if (this.armed) {
      const dir = this.swipe.feed(frame)
      if (dir === -1) events.push('next')
      if (dir === 1) events.push('prev')
      if (this.blackoutHold.feed(frame)) events.push('blackout-toggle')
      if (
        frame.gesture === 'Pointing_Up' &&
        frame.score >= MIN_SCORE &&
        frame.indexTip
      ) {
        laser = { active: true, x: frame.indexTip.x, y: frame.indexTip.y }
      }
    }

    return {
      events,
      armed: this.armed,
      laser,
      armProgress: this.armHold.progress,
      blackoutProgress: this.armed ? this.blackoutHold.progress : 0,
    }
  }
}
