import { describe, expect, test } from 'vitest'
import { DEMO_DECK, parseDeck, tokenizeInline } from './deck'

describe('parseDeck', () => {
  test('splits slides on --- lines', () => {
    const slides = parseDeck('# One\n---\n# Two\n---\n# Three')
    expect(slides).toHaveLength(3)
    expect(slides[1].title).toBe('Two')
  })

  test('parses kicker, title, bullets, statement and paragraphs', () => {
    const [slide] = parseDeck(
      '## Kicker\n# Title\n> Big statement\nA paragraph.\n- one\n- two',
    )
    expect(slide.kicker).toBe('Kicker')
    expect(slide.title).toBe('Title')
    expect(slide.statement).toBe('Big statement')
    expect(slide.paragraphs).toEqual(['A paragraph.'])
    expect(slide.bullets).toEqual(['one', 'two'])
  })

  test('ignores empty blocks and blank lines', () => {
    const slides = parseDeck('\n---\n# Only\n\n---\n   \n')
    expect(slides).toHaveLength(1)
    expect(slides[0].title).toBe('Only')
  })

  test('the demo deck parses into multiple slides', () => {
    const slides = parseDeck(DEMO_DECK)
    expect(slides.length).toBeGreaterThanOrEqual(5)
    expect(slides[0].title).toBe('Present with your hands')
  })
})

describe('tokenizeInline', () => {
  test('plain text passes through', () => {
    expect(tokenizeInline('hello')).toEqual([{ kind: 'text', value: 'hello' }])
  })

  test('bold and code spans are tokenized', () => {
    expect(tokenizeInline('a **b** and `c`')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'bold', value: 'b' },
      { kind: 'text', value: ' and ' },
      { kind: 'code', value: 'c' },
    ])
  })

  test('never produces HTML, only typed tokens', () => {
    const tokens = tokenizeInline('<script>alert(1)</script> **<b>x</b>**')
    for (const t of tokens) {
      expect(['text', 'bold', 'code']).toContain(t.kind)
    }
  })
})
