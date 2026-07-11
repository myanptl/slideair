import { useCallback, useEffect, useRef, useState } from 'react'
import { Deck } from './components/Deck'
import { PdfDeck, ImageDeck } from './components/FileDeck'
import { Hud, Laser } from './components/Hud'
import { DeckModal, HelpOverlay } from './components/Overlays'
import { useGestureEngine } from './hooks/useGestureEngine'
import { DEMO_DECK } from './lib/deck'
import { openPdf, type PdfHandle } from './lib/pdf'
import {
  classifyFile,
  disposeSource,
  imagesSource,
  markdownSource,
  officeHint,
  sourceTotal,
  MAX_IMAGES,
  MAX_PDF_BYTES,
  type DeckSource,
} from './lib/source'
import type { EngineEvent } from './lib/gestures'

const STORAGE_KEY = 'slideair.deck'
const TOAST_MS = 1400
const LOAD_TOAST_MS = 3000
const HINT_TOAST_MS = 5200

export default function App() {
  const [source, setSource] = useState<DeckSource>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) ?? DEMO_DECK
    return markdownSource(stored) ?? (markdownSource(DEMO_DECK) as DeckSource)
  })
  const [index, setIndex] = useState(0)
  const [isBlackout, setIsBlackout] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showDeck, setShowDeck] = useState(false)
  const [isDropping, setIsDropping] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(0)
  const sourceRef = useRef(source)
  sourceRef.current = source

  const total = sourceTotal(source)
  const say = useCallback((msg: string, ms: number = TOAST_MS) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), ms)
  }, [])

  const swapSource = useCallback((next: DeckSource) => {
    disposeSource(sourceRef.current)
    setSource(next)
    setIndex(0)
    setShowDeck(false)
  }, [])

  // Dispose whatever the final source holds when the app unmounts.
  useEffect(() => () => disposeSource(sourceRef.current), [])

  const handleEvent = useCallback(
    (e: EngineEvent) => {
      if (e === 'next') {
        setIndex((i) => Math.min(i + 1, total - 1))
        say('Next')
      } else if (e === 'prev') {
        setIndex((i) => Math.max(i - 1, 0))
        say('Back')
      } else if (e === 'arm-toggle') {
        say('Gesture control toggled')
      }
    },
    [total, say],
  )

  const { status, start, stop, videoRef, subscribeHud, getHud } =
    useGestureEngine(handleEvent)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)
        return
      if (e.key === 'ArrowRight' || e.key === ' ') {
        setIndex((i) => Math.min(i + 1, total - 1))
      } else if (e.key === 'ArrowLeft') {
        setIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'b' || e.key === 'B') {
        setIsBlackout((b) => !b)
      } else if (e.key === 'h' || e.key === 'H') {
        setShowHelp((s) => !s)
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen()
      } else if (e.key === 'Escape') {
        setShowHelp(false)
        setShowDeck(false)
        return
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [total])

  const loadDeck = useCallback(
    (md: string) => {
      const next = markdownSource(md)
      if (!next) return
      swapSource(next)
      localStorage.setItem(STORAGE_KEY, md)
      say(`Deck loaded, ${sourceTotal(next)} slides`, LOAD_TOAST_MS)
    },
    [swapSource, say],
  )

  const loadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const first = files[0]
      const kind = classifyFile(first.name, first.type)

      if (kind === 'office') {
        say(officeHint(first.name), HINT_TOAST_MS)
        return
      }
      if (kind === 'unknown') {
        say(`Can't read ${first.name}. Try a PDF, markdown, text, or images.`)
        return
      }
      if (kind === 'markdown') {
        loadDeck(await first.text())
        return
      }
      if (kind === 'image') {
        const images = files
          .filter((f) => classifyFile(f.name, f.type) === 'image')
          .slice(0, MAX_IMAGES)
          .map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))
        const next = imagesSource(images)
        if (!next) return
        swapSource(next)
        say(
          `${sourceTotal(next)} image slide${sourceTotal(next) === 1 ? '' : 's'} loaded`,
          LOAD_TOAST_MS,
        )
        return
      }
      // PDF
      if (first.size > MAX_PDF_BYTES) {
        say(`${first.name} is over the 50 MB limit.`)
        return
      }
      try {
        say('Opening PDF…')
        const doc = await openPdf(await first.arrayBuffer())
        swapSource({ kind: 'pdf', name: first.name, doc })
        say(`${first.name}, ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`, LOAD_TOAST_MS)
      } catch {
        say(`Couldn't open ${first.name}. Is it a valid, unencrypted PDF?`, HINT_TOAST_MS)
      }
    },
    [say, loadDeck, swapSource],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDropping(false)
      void loadFiles(Array.from(e.dataTransfer.files))
    },
    [loadFiles],
  )

  return (
    <div
      className={`stage ${isDropping ? 'stage-dropping' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDropping(true)
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setIsDropping(false)
      }}
      onDrop={onDrop}
    >
      {source.kind === 'markdown' && (
        <Deck slide={source.slides[index]} index={index} total={total} />
      )}
      {/* pdf sources are always created via openPdf, so doc is a PdfHandle */}
      {source.kind === 'pdf' && (
        <PdfDeck doc={source.doc as PdfHandle} index={index} total={total} />
      )}
      {source.kind === 'images' && (
        <ImageDeck urls={source.urls} index={index} total={total} />
      )}
      <Laser subscribe={subscribeHud} getHud={getHud} />

      <nav className="controls" aria-label="Controls">
        {status === 'running' ? (
          <button className="btn btn-quiet" onClick={stop}>
            Stop camera
          </button>
        ) : (
          <button className="btn" onClick={start} disabled={status === 'loading'}>
            {status === 'loading' ? 'Loading model…' : 'Start camera'}
          </button>
        )}
        <button className="btn btn-quiet" onClick={() => setShowDeck(true)}>
          Deck
        </button>
        <button className="btn btn-quiet" onClick={() => setShowHelp(true)}>
          Help
        </button>
      </nav>

      {status === 'denied' && (
        <p className="notice">
          Camera permission was denied. Allow camera access in the address bar. Keyboard
          arrows still work.
        </p>
      )}
      {status === 'error' && (
        <p className="notice">
          The gesture engine could not start in this browser. Keyboard arrows still work.
        </p>
      )}
      {status === 'idle' && (
        <p className="notice notice-quiet">
          Start the camera, then hold an open palm to arm gesture control. Everything runs
          on this device.
        </p>
      )}

      <Hud
        subscribe={subscribeHud}
        getHud={getHud}
        videoRef={videoRef}
        visible={status === 'running'}
      />

      {isDropping && <div className="drop-hint">Drop to present — PDF, markdown, or images</div>}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {isBlackout && (
        <button
          className="blackout"
          aria-label="Exit blackout"
          onClick={() => setIsBlackout(false)}
        />
      )}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showDeck && (
        <DeckModal
          initial={source.kind === 'markdown' ? source.markdown : ''}
          onLoad={loadDeck}
          onFiles={(files) => void loadFiles(files)}
          onClose={() => setShowDeck(false)}
        />
      )}
    </div>
  )
}
