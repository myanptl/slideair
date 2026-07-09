import { describe, expect, test } from 'vitest'
import { FollowCam } from './followcam'
import type { Box } from './followcam'

/** run updates until the crop settles */
function settle(cam: FollowCam, face: Box | null, t0: number, frames = 120) {
  let box = cam.box
  for (let i = 0; i < frames; i++) box = cam.update(t0 + i * 33, i % 4 === 0 ? face : null)
  return box
}

describe('FollowCam', () => {
  test('stays at full frame while disabled, even with a face', () => {
    const cam = new FollowCam()
    const box = settle(cam, { x: 0.4, y: 0.3, w: 0.1, h: 0.1 }, 0)
    expect(box.w).toBeCloseTo(1, 1)
    expect(cam.zoomed).toBe(false)
  })

  test('zooms toward a small (far away) face when enabled', () => {
    const cam = new FollowCam()
    cam.toggle()
    // face is 8% of the frame: presenter is far, crop should tighten
    const box = settle(cam, { x: 0.46, y: 0.3, w: 0.08, h: 0.08 }, 0)
    expect(box.h).toBeLessThan(0.6)
    expect(cam.zoomed).toBe(true)
  })

  test('zoom is capped for a very small face', () => {
    const cam = new FollowCam()
    cam.toggle()
    const box = settle(cam, { x: 0.48, y: 0.3, w: 0.02, h: 0.02 }, 0)
    expect(box.h).toBeGreaterThanOrEqual(0.4 - 0.01)
  })

  test('a large (close) face keeps the crop near full frame', () => {
    const cam = new FollowCam()
    cam.toggle()
    const box = settle(cam, { x: 0.3, y: 0.2, w: 0.4, h: 0.45 }, 0)
    expect(box.h).toBeGreaterThan(0.95)
  })

  test('crop stays inside the frame when the face is at an edge', () => {
    const cam = new FollowCam()
    cam.toggle()
    const box = settle(cam, { x: 0.0, y: 0.0, w: 0.1, h: 0.1 }, 0)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(1.001)
    expect(box.y + box.h).toBeLessThanOrEqual(1.001)
  })

  test('eases back to full frame when the face is lost', () => {
    const cam = new FollowCam()
    cam.toggle()
    settle(cam, { x: 0.46, y: 0.3, w: 0.08, h: 0.08 }, 0)
    expect(cam.zoomed).toBe(true)
    // 4 seconds with no face at all
    let box = cam.box
    for (let i = 0; i < 120; i++) box = cam.update(5000 + i * 33, null)
    expect(box.h).toBeGreaterThan(0.95)
  })

  test('follows a face that moves across the frame', () => {
    const cam = new FollowCam()
    cam.toggle()
    const left = settle(cam, { x: 0.15, y: 0.3, w: 0.1, h: 0.1 }, 0)
    const leftCenter = left.x + left.w / 2
    // face walks to the right side; detections are in CROP space, so convert
    const target: Box = { x: 0.75, y: 0.3, w: 0.1, h: 0.1 }
    let box = cam.box
    for (let i = 0; i < 240; i++) {
      const b = cam.box
      const inCrop: Box = {
        x: (target.x - b.x) / b.w,
        y: (target.y - b.y) / b.h,
        w: target.w / b.w,
        h: target.h / b.h,
      }
      box = cam.update(10000 + i * 33, i % 4 === 0 ? inCrop : null)
    }
    expect(box.x + box.w / 2).toBeGreaterThan(leftCenter + 0.3)
  })

  test('toggle off returns to full frame', () => {
    const cam = new FollowCam()
    cam.toggle()
    settle(cam, { x: 0.46, y: 0.3, w: 0.08, h: 0.08 }, 0)
    cam.toggle()
    let box = cam.box
    for (let i = 0; i < 120; i++) box = cam.update(20000 + i * 33, null)
    expect(box.h).toBeGreaterThan(0.95)
    expect(cam.enabled).toBe(false)
  })
})
