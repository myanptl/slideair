import { describe, expect, test, vi } from 'vitest'
import {
  classifyFile,
  disposeSource,
  imagesSource,
  markdownSource,
  officeHint,
  sourceTotal,
} from './source'

describe('classifyFile', () => {
  test('recognizes pdfs by extension and mime', () => {
    expect(classifyFile('deck.pdf', '')).toBe('pdf')
    expect(classifyFile('DECK.PDF', '')).toBe('pdf')
    expect(classifyFile('deck', 'application/pdf')).toBe('pdf')
  })

  test('recognizes markdown and text', () => {
    expect(classifyFile('notes.md', '')).toBe('markdown')
    expect(classifyFile('notes.markdown', '')).toBe('markdown')
    expect(classifyFile('notes.txt', 'text/plain')).toBe('markdown')
  })

  test('recognizes images', () => {
    expect(classifyFile('a.png', 'image/png')).toBe('image')
    expect(classifyFile('b.JPEG', '')).toBe('image')
    expect(classifyFile('c.webp', '')).toBe('image')
  })

  test('flags office files for the export-as-pdf hint', () => {
    for (const name of ['deck.pptx', 'deck.ppt', 'deck.key', 'deck.odp', 'doc.docx']) {
      expect(classifyFile(name, '')).toBe('office')
    }
  })

  test('everything else is unknown', () => {
    expect(classifyFile('archive.zip', 'application/zip')).toBe('unknown')
    expect(classifyFile('noextension', '')).toBe('unknown')
  })
})

describe('officeHint', () => {
  test('mentions the file and the export path', () => {
    const hint = officeHint('pitch.pptx')
    expect(hint).toContain('pitch.pptx')
    expect(hint).toContain('Export')
    expect(hint).toContain('PDF')
  })
})

describe('markdownSource', () => {
  test('builds slides from markdown', () => {
    const source = markdownSource('# One\n---\n# Two')
    expect(source?.kind).toBe('markdown')
    expect(source && sourceTotal(source)).toBe(2)
  })

  test('returns null for empty input', () => {
    expect(markdownSource('   ')).toBeNull()
  })
})

describe('imagesSource', () => {
  test('sorts numerically by filename', () => {
    const source = imagesSource([
      { name: '10.png', url: 'u10' },
      { name: '2.png', url: 'u2' },
      { name: '1.png', url: 'u1' },
    ])
    expect(source?.kind === 'images' && source.urls).toEqual(['u1', 'u2', 'u10'])
  })

  test('returns null for no images and counts totals', () => {
    expect(imagesSource([])).toBeNull()
    const single = imagesSource([{ name: 'only.png', url: 'u' }])
    expect(single && sourceTotal(single)).toBe(1)
    expect(single?.kind === 'images' && single.name).toBe('only.png')
  })
})

describe('disposeSource', () => {
  test('revokes object URLs for image sources', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    disposeSource({ kind: 'images', name: 'x', urls: ['a', 'b'] })
    expect(revoke).toHaveBeenCalledTimes(2)
    revoke.mockRestore()
  })

  test('destroys pdf documents and swallows errors', () => {
    const destroy = vi.fn().mockRejectedValue(new Error('already gone'))
    disposeSource({ kind: 'pdf', name: 'x', doc: { numPages: 3, destroy } })
    expect(destroy).toHaveBeenCalled()
  })

  test('does nothing for markdown', () => {
    const source = markdownSource('# hi')
    expect(source).not.toBeNull()
    if (source) disposeSource(source)
  })
})
