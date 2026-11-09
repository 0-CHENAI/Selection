import React from 'react'
import { describe, it, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  isEscapeDuringComposition,
  RichTextInput,
  shouldShowPlaceholder,
} from '../rich-text-input'

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
    expect(html).not.toContain('text-transparent')
  })

  it('shows the placeholder overlay for an empty or caret-newline value (#108)', () => {
    const empty = renderToStaticMarkup(
      React.createElement(RichTextInput, {
        value: '',
        onChange: () => {},
        placeholder: 'Ask anything',
      })
    )
    const caretNewline = renderToStaticMarkup(
      React.createElement(RichTextInput, {
        value: '\n',
        onChange: () => {},
        placeholder: 'Ask anything',
      })
    )
    const filled = renderToStaticMarkup(
      React.createElement(RichTextInput, {
        value: 'hello',
        onChange: () => {},
        placeholder: 'Ask anything',
      })
    )

    expect(empty).toContain('>Ask anything</div>')
    expect(caretNewline).toContain('>Ask anything</div>')
    expect(filled).not.toContain('>Ask anything</div>')
  })

  it('hides the placeholder when the editor DOM is ahead of the controlled value (#133)', () => {
    expect(shouldShowPlaceholder('', false, false, false)).toBe(false)
    expect(shouldShowPlaceholder('', true, false, false)).toBe(true)
    expect(shouldShowPlaceholder('', true, true, false)).toBe(false)
    expect(shouldShowPlaceholder('', true, false, true)).toBe(false)
    expect(shouldShowPlaceholder('hello', true, false, false)).toBe(false)
    expect(shouldShowPlaceholder('\n', true, false, false)).toBe(true)
  })

  it('falls back to the default accessible placeholder for an empty array', () => {
    const html = renderToStaticMarkup(
      React.createElement(RichTextInput, {
        value: '',
        onChange: () => {},
        placeholder: [],
      })
    )

    expect(html).toContain('aria-placeholder="chatInput.placeholder.typeMessage"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('>chatInput.placeholder.typeMessage</div>')
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
