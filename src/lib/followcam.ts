// Digital follow cam: a smoothed crop box that keeps the face centered and at a
// steady size, like a camera operator. Pure logic, unit-testable.
//
// The processing pipeline feeds MediaPipe the CROPPED frame, which is also why
// this improves tracking at a distance: a far-away hand fills far more of the
// zoomed crop than of the full frame.
//
// Coordinate spaces:
// - "full space": normalized 0..1 over the raw camera frame (unmirrored)
// - "crop space": normalized 0..1 over the current crop (what MediaPipe sees)
// Face boxes arrive in crop space (detection runs on the crop) and are
// unmapped internally.

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** face height as a fraction of the crop, the framing we steer toward */
const TARGET_FACE_FRACTION = 0.17
/** tightest allowed crop (0.4 of frame height ≈ 2.5x zoom) */
const MIN_CROP_H = 0.4
/** vertical bias: keep the face in the upper part so hands stay in frame */
const FACE_Y_OFFSET = 0.16
/** per-frame smoothing toward the target crop */
const EASE = 0.08
/** after this long without a face, ease back out to the full frame */
const LOST_MS = 1200

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }

export class FollowCam {
  enabled = false
  private crop: Box = { ...FULL }
  private target: Box = { ...FULL }
  private lastSeen = -Infinity

  /** current crop in full space; feed this to the video-draw call */
  get box(): Box {
    return this.crop
  }

  /** true while zoomed meaningfully past full frame, for the HUD chip */
  get zoomed(): boolean {
    return this.crop.h < 0.98
  }

  toggle(): boolean {
    this.enabled = !this.enabled
    if (!this.enabled) this.target = { ...FULL }
    return this.enabled
  }

  /**
   * Advance one frame. `faceInCrop` is the detected face box in crop space,
   * or null when no face was detected this frame (or detection didn't run).
   */
  update(t: number, faceInCrop: Box | null): Box {
    if (this.enabled && faceInCrop) {
      this.lastSeen = t
      const face = this.unmap(faceInCrop)
      const h = clamp(face.h / TARGET_FACE_FRACTION, MIN_CROP_H, 1)
      const w = h // frame-relative units; drawing preserves the real aspect
      const cx = face.x + face.w / 2
      const cy = face.y + face.h / 2 + h * FACE_Y_OFFSET
      this.target = {
        x: clamp(cx - w / 2, 0, 1 - w),
        y: clamp(cy - h / 2, 0, 1 - h),
        w,
        h,
      }
    } else if (!this.enabled || t - this.lastSeen > LOST_MS) {
      this.target = { ...FULL }
    }

    this.crop = {
      x: ease(this.crop.x, this.target.x),
      y: ease(this.crop.y, this.target.y),
      w: ease(this.crop.w, this.target.w),
      h: ease(this.crop.h, this.target.h),
    }
    return this.crop
  }

  /** crop space -> full space */
  private unmap(b: Box): Box {
    return {
      x: this.crop.x + b.x * this.crop.w,
      y: this.crop.y + b.y * this.crop.h,
      w: b.w * this.crop.w,
      h: b.h * this.crop.h,
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function ease(from: number, to: number): number {
  return from + (to - from) * EASE
}
