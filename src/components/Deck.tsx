import { Fragment } from 'react'
import type { Slide } from '../lib/deck'
import { tokenizeInline } from '../lib/deck'

function Inline({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((t, i) => (
        <Fragment key={i}>
          {t.kind === 'text' && t.value}
          {t.kind === 'bold' && <strong>{t.value}</strong>}
          {t.kind === 'code' && <code>{t.value}</code>}
        </Fragment>
      ))}
    </>
  )
}

export function Deck({ slide, index, total }: { slide: Slide; index: number; total: number }) {
  return (
    <section className="slide" aria-live="polite">
      <div className="slide-body" key={index}>
        {slide.kicker && <p className="kicker">{slide.kicker}</p>}
        {slide.title && (
          <h1 className="slide-title">
            <Inline text={slide.title} />
          </h1>
        )}
        {slide.statement && (
          <p className="statement">
            <Inline text={slide.statement} />
          </p>
        )}
        {slide.paragraphs.map((p, i) => (
          <p className="para" key={i}>
            <Inline text={p} />
          </p>
        ))}
        {slide.bullets.length > 0 && (
          <ul className="bullets">
            {slide.bullets.map((b, i) => (
              <li key={i} style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
                <Inline text={b} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="slide-footer">
        <span className="wordmark">SlideAir</span>
        <span className="page" aria-label={`Slide ${index + 1} of ${total}`}>
          {index + 1} / {total}
        </span>
      </footer>
    </section>
  )
}
