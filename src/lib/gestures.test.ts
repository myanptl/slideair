import { describe, expect, test } from 'vitest'
import {
  GestureEngine,
  HoldDetector,
  LaserTracker,
  SwipeDetector,
  isPointingPose,
} from './gestures'
import type { Frame } from './gestures'

/** default hand scale: a hand at conversational distance (~1m) */
const NEAR = 0.15
/** a hand across the room */
const FAR = 0.055

function frame(over: Partial<Frame>): Frame {
  return {
    t: 0,
    gesture: 'None',
    score: 0,
    handX: 0.5,
    handScale: NEAR,
    indexTip: null,
    pointing: false,
    ...over,
  }
}

function palmAt(t: number, x = 0.5): Frame {
  return frame({ t, gesture: 'Open_Palm', score: 0.9, handX: x })
}

/** Feed a linear motion from x=from to x=to over `ms`, one sample every 33ms. */
function sweep(
  det: SwipeDetector,
  from: number,
  to: number,
  t0: number,
  ms = 200,
  scale = NEAR,
  mutate: (f: Frame, i: number) => Frame = (f) => f,
) {
  const results: number[] = []
  const steps = Math.round(ms / 33)
  for (let i = 0; i <= steps; i++) {
    const f = frame({
      t: t0 + i * 33,
      handX: from + ((to - from) * i) / steps,
      handScale: scale,
    })
    results.push(det.feed(mutate(f, i)))
  }
  return results
}

describe('HoldDetector', () => {
  test('fires once after the hold duration', () => {
    const hold = new HoldDetector('Open_Palm', 700)
    expect(hold.feed(palmAt(0))).toBe(false)
    expect(hold.feed(palmAt(350))).toBe(false)
    expect(hold.feed(palmAt(700))).toBe(true)
    expect(hold.feed(palmAt(900))).toBe(false)
  })

  test('cancels when the hand drifts sideways', () => {
    const hold = new HoldDetector('Open_Palm', 700)
    hold.feed(palmAt(0, 0.5))
    hold.feed(palmAt(300, 0.62))
    expect(hold.feed(palmAt(700, 0.62))).toBe(false)
    expect(hold.feed(palmAt(1000, 0.62))).toBe(true)
  })
})

describe('SwipeDetector', () => {
  test('a big arm swipe near the camera fires', () => {
    const det = new SwipeDetector()
    expect(sweep(det, 0.8, 0.45, 0)).toContain(-1)
  })

  test('REGRESSION: a wrist flick fires (small on screen, fast for the hand)', () => {
    // fingertips travel ~1.5 hand-scales in ~130ms; on screen that is
    // only 0.23 of the frame, which the old frame-relative thresholds needed
    const det = new SwipeDetector()
    expect(sweep(det, 0.6, 0.375, 0, 133)).toContain(-1)
  })

  test('REGRESSION: the same wrist flick fires from across the room', () => {
    // far away the identical flick covers just 8% of the frame;
    // hand-scale units make it identical to the near case
    const det = new SwipeDetector()
    expect(sweep(det, 0.5, 0.417, 0, 133, FAR)).toContain(-1)
  })

  test('rightward flick fires 1', () => {
    const det = new SwipeDetector()
    expect(sweep(det, 0.4, 0.63, 0, 133)).toContain(1)
  })

  test('survives a tracking dropout mid-flick', () => {
    const det = new SwipeDetector()
    const results = sweep(det, 0.7, 0.4, 0, 200, NEAR, (f, i) =>
      i === 3 || i === 4 ? { ...f, handX: null } : f,
    )
    expect(results).toContain(-1)
  })

  test('ignores slow drift, even a large one', () => {
    const det = new SwipeDetector()
    const results: number[] = []
    for (let i = 0; i <= 30; i++) {
      results.push(det.feed(frame({ t: i * 100, handX: 0.2 + i * 0.02 })))
    }
    expect(results.every((r) => r === 0)).toBe(true)
  })

  test('ignores talking-hands wobble (sub-threshold oscillation)', () => {
    const det = new SwipeDetector()
    const results: number[] = []
    for (let i = 0; i <= 60; i++) {
      const x = 0.5 + Math.sin(i / 3) * 0.05
      results.push(det.feed(frame({ t: i * 33, handX: x })))
    }
    expect(results.every((r) => r === 0)).toBe(true)
  })

  test('returning the hand after a flick never fires the opposite way', () => {
    const det = new SwipeDetector()
    expect(sweep(det, 0.7, 0.4, 0)).toContain(-1)
    const back = sweep(det, 0.4, 0.7, 700, 250)
    expect(back).not.toContain(1)
  })

  test('cooldown plus rearm allows a second same-direction flick', () => {
    const det = new SwipeDetector()
    expect(sweep(det, 0.7, 0.4, 0)).toContain(-1)
    expect(sweep(det, 0.7, 0.4, 250)).not.toContain(-1)
    for (let t = 500; t <= 1400; t += 33) det.feed(frame({ t, handX: 0.7 }))
    expect(sweep(det, 0.7, 0.4, 1450)).toContain(-1)
  })

  test('a tracking teleport does not read as a swipe', () => {
    const det = new SwipeDetector()
    det.feed(frame({ t: 0, handX: 0.8 }))
    det.feed(frame({ t: 33, handX: 0.79 }))
    // re-detection on the other side of the frame
    const results = [
      det.feed(frame({ t: 66, handX: 0.3 })),
      det.feed(frame({ t: 99, handX: 0.29 })),
      det.feed(frame({ t: 132, handX: 0.28 })),
    ]
    expect(results.every((r) => r === 0)).toBe(true)
  })

  test('does not fire while pointing (laser in use)', () => {
    const det = new SwipeDetector()
    const results = sweep(det, 0.8, 0.4, 0, 200, NEAR, (f) => ({ ...f, pointing: true }))
    expect(results.every((r) => r === 0)).toBe(true)
  })

  test('ignores degenerate hand-scale readings', () => {
    const det = new SwipeDetector()
    const results = sweep(det, 0.8, 0.4, 0, 200, 0.001)
    expect(results.every((r) => r === 0)).toBe(true)
  })
})

describe('isPointingPose', () => {
  function hand(dists: Record<number, number>): Array<{ x: number; y: number }> {
    const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
    for (const [idx, d] of Object.entries(dists)) {
      lm[Number(idx)] = { x: 0.5 + Number(d), y: 0.5 }
    }
    return lm
  }

  test('index extended with middle and ring curled is pointing', () => {
    const lm = hand({ 6: 0.15, 8: 0.28, 10: 0.14, 12: 0.1, 14: 0.13, 16: 0.09 })
    expect(isPointingPose(lm)).toBe(true)
  })

  test('open palm (all fingers extended) is not pointing', () => {
    const lm = hand({ 6: 0.15, 8: 0.28, 10: 0.14, 12: 0.27, 14: 0.13, 16: 0.25 })
    expect(isPointingPose(lm)).toBe(false)
  })

  test('fist (all fingers curled) is not pointing', () => {
    const lm = hand({ 6: 0.15, 8: 0.1, 10: 0.14, 12: 0.09, 14: 0.13, 16: 0.08 })
    expect(isPointingPose(lm)).toBe(false)
  })

  test('rejects incomplete landmark arrays', () => {
    expect(isPointingPose([{ x: 0, y: 0 }])).toBe(false)
  })
})

describe('LaserTracker', () => {
  const tip = { x: 0.5, y: 0.5 }

  test('turns on only after a streak of pointing frames', () => {
    const laser = new LaserTracker()
    expect(laser.feed(frame({ t: 0, pointing: true, indexTip: tip })).active).toBe(false)
    expect(laser.feed(frame({ t: 33, pointing: true, indexTip: tip })).active).toBe(false)
    expect(laser.feed(frame({ t: 66, pointing: true, indexTip: tip })).active).toBe(true)
  })

  test('survives a short pointing gap, turns off after a long one', () => {
    const laser = new LaserTracker()
    for (let t = 0; t <= 132; t += 33) laser.feed(frame({ t, pointing: true, indexTip: tip }))
    expect(laser.feed(frame({ t: 232, pointing: false })).active).toBe(true)
    expect(laser.feed(frame({ t: 632, pointing: false })).active).toBe(false)
  })

  test('maps the central camera region to the full slide', () => {
    const laser = new LaserTracker()
    const edge = { x: 0.18, y: 0.5 }
    let out = { active: false, x: 1, y: 1 }
    for (let t = 0; t <= 330; t += 33) {
      out = laser.feed(frame({ t, pointing: true, indexTip: edge }))
    }
    expect(out.active).toBe(true)
    expect(out.x).toBeLessThan(0.01)
  })

  test('smooths jitter instead of teleporting', () => {
    const laser = new LaserTracker()
    for (let t = 0; t <= 99; t += 33) laser.feed(frame({ t, pointing: true, indexTip: tip }))
    const jumped = laser.feed(
      frame({ t: 132, pointing: true, indexTip: { x: 0.8, y: 0.5 } }),
    )
    expect(jumped.x).toBeGreaterThan(0.5)
    expect(jumped.x).toBeLessThan(0.95)
  })
})

describe('GestureEngine', () => {
  function arm(engine: GestureEngine, t0: number) {
    for (let t = t0; t <= t0 + 750; t += 33) engine.step(palmAt(t))
  }

  test('starts disarmed and ignores flicks', () => {
    const engine = new GestureEngine()
    let events: string[] = []
    for (let i = 0; i <= 6; i++) {
      const s = engine.step(frame({ t: i * 33, handX: 0.7 - i * 0.05 }))
      events = events.concat(s.events)
    }
    expect(events).toEqual([])
  })

  test('arms after a palm hold, then flicks navigate', () => {
    const engine = new GestureEngine()
    arm(engine, 0)
    expect(engine.step(frame({ t: 1000, handX: 0.7 })).armed).toBe(true)
    let events: string[] = []
    for (let i = 0; i <= 6; i++) {
      const s = engine.step(frame({ t: 2000 + i * 33, handX: 0.7 - i * 0.05 }))
      events = events.concat(s.events)
    }
    expect(events).toContain('next')
  })

  test('laser needs both arming and pointing', () => {
    const engine = new GestureEngine()
    const point = frame({ t: 0, pointing: true, indexTip: { x: 0.5, y: 0.5 } })
    for (let t = 0; t <= 132; t += 33) {
      expect(engine.step({ ...point, t }).laser.active).toBe(false)
    }
    arm(engine, 200)
    let active = false
    for (let t = 2000; t <= 2132; t += 33) {
      active = engine.step({ ...point, t }).laser.active
    }
    expect(active).toBe(true)
  })
})
