import { useCallback, useEffect, useRef, useState } from 'react'
import { Deck } from './components/Deck'
import { Hud, Laser } from './components/Hud'
import { DeckModal, HelpOverlay } from './components/Overlays'
import { useGestureEngine } from './hooks/useGestureEngine'
import { DEMO_DECK, parseDeck } from './lib/deck'
import type { EngineEvent } from './lib/gestures'

const STORAGE_KEY = 'slideair.deck'
const TOAST_MS = 1400

export default function App() {
  const [markdown, setMarkdown] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? DEMO_DECK,
  )
  const [slides, setSlides] = useState(() => parseDeck(markdown))
  const [index, setIndex] = useState(0)
  const [isBlackout, setIsBlackout] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showDeck, setShowDeck] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(0)

  const total = slides.length
  const say = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), TOAST_MS)
  }, [])

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
      } else if (e === 'follow-toggle') {
        say('Follow cam toggled')
      }
    },
    [total, say],
  )

  const { status, start, stop, videoRef, procRef, subscribeHud, getHud, toggleFollow } =
    useGestureEngine(handleEvent)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight' || e.key === ' ') {
        setIndex((i) => Math.min(i + 1, total - 1))
      } else if (e.key === 'ArrowLeft') {
        setIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'b' || e.key === 'B') {
        setIsBlackout((b) => !b)
      } else if (e.key === 'h' || e.key === 'H') {
        setShowHelp((s) => !s)
      } else if (e.key === 'c' || e.key === 'C') {
        toggleFollow()
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
  }, [total, toggleFollow])

  const loadDeck = (md: string) => {
    const parsed = parseDeck(md)
    if (parsed.length === 0) return
    setMarkdown(md)
    setSlides(parsed)
    setIndex(0)
    setShowDeck(false)
    localStorage.setItem(STORAGE_KEY, md)
    say(`Deck loaded, ${parsed.length} slides`)
  }

  return (
    <div className="stage">
      <Deck slide={slides[index]} index={index} total={total} />
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
        procRef={procRef}
        visible={status === 'running'}
      />

      {toast && <div className="toast">{toast}</div>}
      {isBlackout && (
        <button
          className="blackout"
          aria-label="Exit blackout"
          onClick={() => setIsBlackout(false)}
        />
      )}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showDeck && (
        <DeckModal initial={markdown} onLoad={loadDeck} onClose={() => setShowDeck(false)} />
      )}
    </div>
  )
}
