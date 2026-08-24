import React from 'react'
import { describe, it, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { isEscapeDuringComposition, RichTextInput } from '../rich-text-input'

describe('RichTextInput IME attributes', () => {
  it('keeps browser first-letter processing disabled', () => {
    const html = renderToStaticMarkup(
      React.createElement(RichTextInput, {
        value: '',
        onChange: () => {},
        placeholder: 'Message',
        autoCapitalize: 'sentences',
        autoCorrect: 'on',
      })
    )

    expect(html).toContain('autoCapitalize="none"')
    expect(html).toContain('autoCorrect="off"')
    expect(html).toContain('spellcheck="false"')
    expect(html).not.toContain('autoCapitalize="sentences"')
    expect(html).not.toContain('autoCorrect="on"')
  })
})

describe('isEscapeDuringComposition', () => {
  it('returns true for Escape when local composition ref is active', () => {
    expect(isEscapeDuringComposition({ key: 'Escape' }, true)).toBe(true)
  })

  it('returns true for Escape when nativeEvent.isComposing is true', () => {
    expect(
      isEscapeDuringComposition(
        { key: 'Escape', nativeEvent: { isComposing: true } },
        false
      )
    ).toBe(true)
  })

  it('returns true for Escape when event.isComposing is true', () => {
    expect(isEscapeDuringComposition({ key: 'Escape', isComposing: true }, false)).toBe(true)
  })

  it('returns false for Escape when no composition signal is active', () => {
    expect(isEscapeDuringComposition({ key: 'Escape' }, false)).toBe(false)
  })

  it('returns false for non-Escape keys even if composing', () => {
    expect(isEscapeDuringComposition({ key: 'Enter', isComposing: true }, true)).toBe(false)
  })
})
