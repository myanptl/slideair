// Minimal markdown-to-slides parser. Slides are separated by lines containing only `---`.
// Supported per slide: `# title`, `## kicker`, `- bullet`, `> big statement`, paragraphs.
// Inline: **bold** and `code`. Rendered as React nodes elsewhere, so no HTML injection.

export interface Slide {
  kicker?: string
  title?: string
  bullets: string[]
  statement?: string
  paragraphs: string[]
}

export function parseDeck(markdown: string): Slide[] {
  const blocks = markdown
    .replace(/\r\n/g, '\n')
    .split(/\n\s*---\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  return blocks.map((block) => {
    const slide: Slide = { bullets: [], paragraphs: [] }
    for (const raw of block.split('\n')) {
      const line = raw.trimEnd()
      if (!line.trim()) continue
      if (line.startsWith('## ')) slide.kicker = line.slice(3).trim()
      else if (line.startsWith('# ')) slide.title = line.slice(2).trim()
      else if (line.startsWith('- ')) slide.bullets.push(line.slice(2).trim())
      else if (line.startsWith('> ')) slide.statement = line.slice(2).trim()
      else slide.paragraphs.push(line.trim())
    }
    return slide
  })
}

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'code'; value: string }

/** Tokenize **bold** and `code` spans. Everything else is plain text. */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) tokens.push({ kind: 'text', value: text.slice(last, match.index) })
    if (match[2] !== undefined) tokens.push({ kind: 'bold', value: match[2] })
    else tokens.push({ kind: 'code', value: match[3] })
    last = match.index + match[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) })
  return tokens
}

export const DEMO_DECK = `## SlideAir
# Present with your hands
Camera on. Nothing leaves this device.

Raise an open palm and hold it for a moment to arm the controls.
---
## How it works
# Three gestures
- **Swipe left** to go to the next slide
- **Swipe right** to go back
- **Point at the screen** and a laser dot follows your fingertip
---
## Try it
> Give a quick flick to the left.
---
## The laser
# Point at things
Extend your index finger, curl the others, and aim anywhere on the slide.

Small hand movements cover the whole screen.
---
## Safety
# It never misfires
- A held **open palm** arms and disarms everything
- Disarmed, you can talk with your hands freely
- Keyboard always works: arrows, **F** fullscreen, **B** blackout
---
## Under the hood
# On-device AI
- Google **MediaPipe** hand tracking, 21 landmarks per hand
- Runs in your browser with WebAssembly
- No account, no upload, no server
---
## Your turn
# Load your own deck
Open the deck menu and paste markdown. Slides are separated by \`---\` lines.

Built by Myan Patel. Part of the Conductor project.`
