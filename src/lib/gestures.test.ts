import { describe, expect, test } from 'vitest'
import { GestureEngine, HoldDetector, SwipeDetector } from './gestures'
import type { Frame, GestureName } from './gestures'

function frame(over: Partial<Frame>): Frame {
  return { t: 0, gesture: 'None', score: 0, wristX: 0.5, indexTip: null, ...over }
}

function palmAt(t: number, x = 0.5): Frame {
  return frame({ t, gesture: 'Open_Palm', score: 0.9, wristX: x })
}

describe('HoldDetector', () => {
  test('fires once after the hold duration', () => {
    const hold = new HoldDetector('Open_Palm', 700)
    expect(hold.feed(palmAt(0))).toBe(false)
    expect(hold.feed(palmAt(350))).toBe(false)
    expect(hold.feed(palmAt(700))).toBe(true)
    expect(hold.feed(palmAt(900))).toBe(false)
  })

  test('resets when the gesture is released', () => {
    const hold = new HoldDetector('Open_Palm', 700)
    hold.feed(palmAt(0))
    hold.feed(frame({ t: 400, gesture: 'None', score: 0 }))
    // gap longer than flicker tolerance means the timer restarted
    expect(hold.feed(palmAt(700))).toBe(false)
    expect(hold.feed(palmAt(1400))).toBe(true)
  })

  test('tolerates a brief model flicker', () => {
    const hold = new HoldDetector('Open_Palm', 700)
    for (let t = 0; t <= 300; t += 33) hold.feed(palmAt(t))
    // two dropped frames, well inside the 150ms flicker window
    hold.feed(frame({ t: 333, gesture: 'None', score: 0 }))
    hold.feed(frame({ t: 366, gesture: 'None', score: 0 }))
    expect(hold.feed(palmAt(400))).toBe(false)
    expect(hold.feed(palmAt(700))).toBe(true)
  })

  test('cancels when the hand drifts sideways', () => {
    const hold = new HoldDetector('Open_Palm', 700)
    hold.feed(palmAt(0, 0.5))
    hold.feed(palmAt(300, 0.62))
    expect(hold.feed(palmAt(700, 0.62))).toBe(false)
    expect(hold.feed(palmAt(1000, 0.62))).toBe(true)
  })

  test('reports progress between 0 and 1', () => {
    const hold = new HoldDetector('Open_Palm', 700)
    hold.feed(palmAt(0))
    hold.feed(palmAt(350))
    expect(hold.progress).toBeCloseTo(0.5, 1)
  })
})

describe('SwipeDetector', () => {
  function sweep(det: SwipeDetector, from: number, to: number, t0: number) {
    const results: number[] = []
    for (let i = 0; i <= 6; i++) {
      const x = from + ((to - from) * i) / 6
      results.push(det.feed(frame({ t: t0 + i * 40, wristX: x })))
    }
    return results
  }

  test('detects a fast left swipe as -1', () => {
    const det = new SwipeDetector()
    const results = sweep(det, 0.8, 0.4, 0)
    expect(results).toContain(-1)
  })

  test('detects a fast right swipe as 1', () => {
    const det = new SwipeDetector()
    const results = sweep(det, 0.3, 0.75, 0)
    expect(results).toContain(1)
  })

  test('ignores slow drift', () => {
    const det = new SwipeDetector()
    const results: number[] = []
    for (let i = 0; i <= 20; i++) {
      results.push(det.feed(frame({ t: i * 200, wristX: 0.3 + i * 0.02 })))
    }
    expect(results.every((r) => r === 0)).toBe(true)
  })

  test('enforces a cooldown between swipes', () => {
    const det = new SwipeDetector()
    expect(sweep(det, 0.8, 0.4, 0)).toContain(-1)
    expect(sweep(det, 0.8, 0.4, 300)).not.toContain(-1)
    expect(sweep(det, 0.8, 0.4, 2000)).toContain(-1)
  })

  test('ignores movement while pointing', () => {
    const det = new SwipeDetector()
    const results: number[] = []
    for (let i = 0; i <= 6; i++) {
      results.push(
        det.feed(
          frame({
            t: i * 40,
            gesture: 'Pointing_Up',
            score: 0.9,
            wristX: 0.8 - i * 0.07,
          }),
        ),
      )
    }
    expect(results.every((r) => r === 0)).toBe(true)
  })
})

describe('GestureEngine', () => {
  function arm(engine: GestureEngine, t0: number) {
    for (let t = t0; t <= t0 + 750; t += 50) engine.step(palmAt(t))
  }

  test('starts disarmed and ignores swipes', () => {
    const engine = new GestureEngine()
    let events: string[] = []
    for (let i = 0; i <= 6; i++) {
      const s = engine.step(frame({ t: i * 40, wristX: 0.8 - i * 0.07 }))
      events = events.concat(s.events)
    }
    expect(events).toEqual([])
  })

  test('arms after a palm hold, then swipes navigate', () => {
    const engine = new GestureEngine()
    arm(engine, 0)
    expect(engine.step(frame({ t: 1000, wristX: 0.8 })).armed).toBe(true)
    let events: string[] = []
    for (let i = 0; i <= 6; i++) {
      const s = engine.step(frame({ t: 2000 + i * 40, wristX: 0.8 - i * 0.07 }))
      events = events.concat(s.events)
    }
    expect(events).toContain('next')
  })

  test('laser only works while armed and pointing', () => {
    const engine = new GestureEngine()
    const point = frame({
      t: 100,
      gesture: 'Pointing_Up' as GestureName,
      score: 0.9,
      indexTip: { x: 0.4, y: 0.3 },
    })
    expect(engine.step(point).laser.active).toBe(false)
    arm(engine, 200)
    const armedPoint = { ...point, t: 2000 }
    const state = engine.step(armedPoint)
    expect(state.laser).toEqual({ active: true, x: 0.4, y: 0.3 })
  })

  test('fist hold toggles blackout while armed', () => {
    const engine = new GestureEngine()
    arm(engine, 0)
    let events: string[] = []
    for (let t = 2000; t <= 2700; t += 50) {
      const s = engine.step(frame({ t, gesture: 'Closed_Fist', score: 0.9 }))
      events = events.concat(s.events)
    }
    expect(events).toContain('blackout-toggle')
  })
})
