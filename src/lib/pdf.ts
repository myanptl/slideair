// The only module that touches pdf.js. Loaded lazily so the main bundle stays
// lean — the library and its worker are fetched the first time a PDF is opened.

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { PdfDocLike } from './source'

type PdfJs = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return pdfjsPromise
}

/** A PdfDocLike whose `proxy` is the real pdf.js document. */
export interface PdfHandle extends PdfDocLike {
  proxy: PDFDocumentProxy
}

export async function openPdf(data: ArrayBuffer): Promise<PdfHandle> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data })
  const proxy = await task.promise
  return {
    proxy,
    numPages: proxy.numPages,
    destroy: () => task.destroy(),
  }
}

export interface PageRenderHandle {
  cancel: () => void
  done: Promise<boolean>
}

/**
 * Renders page `pageNumber` into `canvas`, scaled to fit inside fitW×fitH
 * (contain) and multiplied by devicePixelRatio for crisp output.
 * `done` resolves false if cancelled or failed.
 */
export function renderPage(
  pdf: PdfHandle,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  fitW: number,
  fitH: number,
): PageRenderHandle {
  let cancelled = false
  let task: RenderTask | null = null

  const done = (async () => {
    try {
      const page = await pdf.proxy.getPage(pageNumber)
      if (cancelled) return false
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(fitW / base.width, fitH / base.height)
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1

      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      if (cancelled) return false

      task = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      await task.promise
      return !cancelled
    } catch {
      return false
    }
  })()

  return {
    cancel: () => {
      cancelled = true
      task?.cancel()
    },
    done,
  }
}
