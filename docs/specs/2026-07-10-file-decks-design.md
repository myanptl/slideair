# SlideAir — File Decks (PDF, Markdown files, Images)

**Date:** 2026-07-10 · **Status:** Approved

## Goal

Present a real deck in SlideAir without converting it to markdown. Upload a PDF
(or drop one on the window) and swipe through it with gestures. Everything stays
on-device — no upload, no server, consistent with SlideAir's privacy story.

## Supported inputs

| Input | Handling |
|---|---|
| `.pdf` | Rendered client-side with pdf.js (lazy-loaded). Max 50 MB. |
| `.md` / `.markdown` / `.txt` | Read as text, fed to the existing markdown parser, persisted like a pasted deck. |
| Images (`.png .jpg .jpeg .webp .gif`, multi-select) | One slide per image, sorted by filename. Max 40. |
| `.pptx .ppt .key .odp .doc(x) .xls(x)` | Friendly hint: "Export it as a PDF first (File → Export → PDF) — it stays pixel-perfect." No janky conversion attempts. |
| Anything else | "Can't read that file type" toast. |

## Architecture

- `src/lib/source.ts` — pure, testable: `DeckSource` union (`markdown | pdf | images`),
  `classifyFile(name, mime)`, `markdownSource()`, `imagesSource()`, `sourceTotal()`,
  `officeHint()`, size/count limits.
- `src/lib/pdf.ts` — the only module touching pdf.js. Dynamic `import('pdfjs-dist')`
  + worker via Vite `?url` so the main bundle stays lean. `openPdf(ArrayBuffer)`,
  `renderPage(doc, n, canvas, fitW, fitH)` with devicePixelRatio scaling and
  `isEvalSupported: false`.
- `src/components/FileDeck.tsx` — `PdfDeck` (canvas, renders current page, cancels
  stale render tasks, re-renders on resize) and `ImageDeck` (`<img>`). Both reuse the
  existing footer look (wordmark + `n / N`).
- `App.tsx` — `source: DeckSource` state replaces bare `slides`; `loadFiles(File[])`
  dispatcher; drag-and-drop on the stage with a visual drop hint; object URLs revoked
  and PDF docs destroyed when replaced.
- `Overlays.tsx` DeckModal — "Open a file" button (hidden file input) alongside the
  markdown textarea.

## Unchanged

Gestures, laser, blackout, keyboard nav, HUD, camera pipeline, markdown decks and
their localStorage persistence. PDFs/images are session-only (too big to persist,
and more private).

## Error handling

Corrupt/encrypted PDF → toast, keep current deck. Oversized file → toast with the
limit. Every failure path leaves the current deck presenting.

## Testing

- Vitest: `source.test.ts` (classification, source building, ordering, limits, hints).
- Existing deck/gesture tests untouched and green.
- Agent-driven Playwright pass against the dev server: open PDF via picker and
  drag-drop, navigate with keyboard, verify canvas paints, office-file hint shows.
