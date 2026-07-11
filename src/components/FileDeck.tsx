import { useEffect, useRef, useState } from 'react'
import { renderPage, type PdfHandle } from '../lib/pdf'

function SlideFooter({ index, total }: { index: number; total: number }) {
  return (
    <footer className="slide-footer">
      <span className="wordmark">SlideAir</span>
      <span className="page" aria-label={`Slide ${index + 1} of ${total}`}>
        {index + 1} / {total}
      </span>
    </footer>
  )
}

export function PdfDeck({
  doc,
  index,
  total,
}: {
  doc: PdfHandle
  index: number
  total: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  // Bumps on window resize so the effect below re-renders the page to fit.
  const [fitEpoch, setFitEpoch] = useState(0)

  useEffect(() => {
    const onResize = () => setFitEpoch((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    if (!canvas || !frame) return
    const handle = renderPage(
      doc,
      index + 1,
      canvas,
      frame.clientWidth,
      frame.clientHeight,
    )
    void handle.done.then((ok) => {
      // A cancelled render is not a failure; only flag pages that never painted.
      if (ok) setFailed(false)
      else if (canvas.width === 0) setFailed(true)
    })
    return () => handle.cancel()
  }, [doc, index, fitEpoch])

  return (
    <section className="slide file-slide" aria-live="polite">
      <div className="file-frame" ref={frameRef}>
        <canvas ref={canvasRef} className="pdf-canvas" data-page={index + 1} />
        {failed && <p className="notice">This page could not be rendered.</p>}
      </div>
      <SlideFooter index={index} total={total} />
    </section>
  )
}

export function ImageDeck({
  urls,
  index,
  total,
}: {
  urls: string[]
  index: number
  total: number
}) {
  return (
    <section className="slide file-slide" aria-live="polite">
      <div className="file-frame">
        <img
          className="image-slide"
          src={urls[index]}
          alt={`Slide ${index + 1} of ${total}`}
        />
      </div>
      <SlideFooter index={index} total={total} />
    </section>
  )
}
