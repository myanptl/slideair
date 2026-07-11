import { useRef, useState } from 'react'

const GESTURES: Array<[string, string]> = [
  ['Open palm, hold', 'Arm or disarm gesture control'],
  ['Flick left', 'Next slide, a wrist flick is enough'],
  ['Flick right', 'Previous slide'],
  ['Point at the screen', 'Laser dot follows your fingertip'],
]

const KEYS: Array<[string, string]> = [
  ['← →', 'Previous / next slide'],
  ['F', 'Fullscreen'],
  ['B', 'Blackout'],
  ['H', 'This help'],
]

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-label="Help" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="panel-title">Gestures</h2>
        <dl className="legend">
          {GESTURES.map(([g, d]) => (
            <div className="legend-row" key={g}>
              <dt>{g}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <h2 className="panel-title">Keyboard</h2>
        <dl className="legend">
          {KEYS.map(([k, d]) => (
            <div className="legend-row" key={k}>
              <dt>{k}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <p className="fineprint">
          Gestures only fire while armed. Everything runs on this device, video is never
          uploaded.
        </p>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export function DeckModal({
  initial,
  onLoad,
  onFiles,
  onClose,
}: {
  initial: string
  onLoad: (md: string) => void
  onFiles: (files: File[]) => void
  onClose: () => void
}) {
  const [text, setText] = useState(initial)
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="overlay" role="dialog" aria-label="Load deck" onClick={onClose}>
      <div className="panel panel-wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="panel-title">Present a file</h2>
        <p className="fineprint">
          PDF, markdown, text, or images (one slide each). PowerPoint or Keynote? Export
          it as a PDF first — it stays pixel-perfect. Files never leave this device.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.md,.markdown,.txt,image/*"
          multiple
          hidden
          data-testid="deck-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) onFiles(files)
            e.target.value = ''
          }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Open a file…
        </button>
        <h2 className="panel-title">Or paste markdown</h2>
        <p className="fineprint">
          Separate slides with a line containing only <code>---</code>. Use{' '}
          <code># heading</code>, <code>## kicker</code>, <code>- bullets</code> and{' '}
          <code>&gt; big statements</code>. Saved in your browser only.
        </p>
        <textarea
          className="deck-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Deck markdown"
        />
        <div className="panel-actions">
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => onLoad(text)} disabled={!text.trim()}>
            Load deck
          </button>
        </div>
      </div>
    </div>
  )
}
