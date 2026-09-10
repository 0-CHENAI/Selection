import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #332: the model menu is the only composer picker whose trigger also carries a
 * tooltip. Radix restores focus to that trigger once the exit animation unmounts
 * the menu, and the focus event re-opens the tooltip while the pointer is already
 * elsewhere, so nothing closes it again. The composer must refuse that restore.
 *
 * Removing the tooltip is not an acceptable fix: the label is the picker's only
 * affordance for what the button changes.
 */
const source = readFileSync(join(import.meta.dir, '../FreeFormInput.tsx'), 'utf8')

const pickerStart = source.indexOf('<DropdownMenu open={modelDropdownOpen}')
const pickerEnd = source.indexOf('</StyledDropdownMenuContent>', pickerStart)
const modelPicker = pickerStart >= 0 && pickerEnd > pickerStart
  ? source.slice(pickerStart, pickerEnd)
  : ''

describe('composer model picker close focus (#332)', () => {
  test('locates the model picker region in the composer source', () => {
    expect(modelPicker).not.toBe('')
    expect(modelPicker).toContain('<DropdownMenuTrigger asChild>')
  })

  test('keeps the model label available as a hover/focus tooltip on the trigger', () => {
    expect(modelPicker).toContain('<TooltipTrigger asChild>')
    expect(modelPicker).toContain("{t('common.model')}")
  })

  test('blocks the overlay focus restore when the menu closes', () => {
    expect(modelPicker).toContain('onCloseAutoFocus={keepComposerFocusOnPickerClose}')
    expect(source).toMatch(
      /import \{[^}]*keepComposerFocusOnPickerClose[^}]*\} from '\.\/restore-composer-focus'/,
    )
  })

  test('still hands the caret back to the composer as soon as the menu closes', () => {
    expect(source).toContain('if (!open) focusComposerAfterPicker()')
  })
})
