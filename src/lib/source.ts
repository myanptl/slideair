// Deck sources: what SlideAir can present. Markdown is the original path;
// pdf and images come from files. This module is pure — pdf.js lives in pdf.ts.

import type { Slide } from './deck'
import { parseDeck } from './deck'

export const MAX_PDF_BYTES = 50 * 1024 * 1024
export const MAX_IMAGES = 40

export type FileKind = 'pdf' | 'markdown' | 'image' | 'office' | 'unknown'

export interface PdfDocLike {
  numPages: number
  destroy: () => Promise<void>
}

export type DeckSource =
  | { kind: 'markdown'; markdown: string; slides: Slide[] }
  | { kind: 'pdf'; name: string; doc: PdfDocLike }
  | { kind: 'images'; name: string; urls: string[] }

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'txt'])
const OFFICE_EXTENSIONS = new Set([
  'ppt', 'pptx', 'key', 'odp', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'pages', 'numbers',
])

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] ?? ''
}

export function classifyFile(name: string, mimeType: string): FileKind {
  const ext = extensionOf(name)
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) return 'image'
  if (MARKDOWN_EXTENSIONS.has(ext) || mimeType === 'text/markdown' || mimeType === 'text/plain')
    return 'markdown'
  if (OFFICE_EXTENSIONS.has(ext)) return 'office'
  return 'unknown'
}

export function officeHint(name: string): string {
  return `${name} is a presentation/office file. Export it as a PDF first (File → Export → PDF) — it stays pixel-perfect.`
}

export function markdownSource(markdown: string): DeckSource | null {
  const slides = parseDeck(markdown)
  if (slides.length === 0) return null
  return { kind: 'markdown', markdown, slides }
}

/** One slide per image, sorted by filename so `01.png, 02.png…` presents in order. */
export function imagesSource(images: Array<{ name: string; url: string }>): DeckSource | null {
  if (images.length === 0) return null
  const sorted = [...images].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  )
  return {
    kind: 'images',
    name: sorted.length === 1 ? (sorted[0]?.name ?? '') : `${sorted.length} images`,
    urls: sorted.map((image) => image.url),
  }
}

export function sourceTotal(source: DeckSource): number {
  if (source.kind === 'markdown') return source.slides.length
  if (source.kind === 'pdf') return source.doc.numPages
  return source.urls.length
}

/** Free whatever the outgoing source holds (object URLs, pdf.js worker memory). */
export function disposeSource(source: DeckSource): void {
  if (source.kind === 'images') {
    for (const url of source.urls) URL.revokeObjectURL(url)
  } else if (source.kind === 'pdf') {
    void source.doc.destroy().catch(() => {})
  }
}
