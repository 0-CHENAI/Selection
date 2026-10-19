import { describe, expect, test } from 'bun:test'
import {
  TOOLBAR_SHELL_MAX,
  centeredShellBudget,
  toolbarCapsuleFit,
} from '../toolbar-capsule-fit'

describe('toolbar capsule fit', () => {
  test('keeps a centered shell inside the narrower side, capped at 420', () => {
    expect(centeredShellBudget(800, 120, 110, 36, 8)).toBe(492)
    expect(toolbarCapsuleFit({
      rowWidth: 800,
      leftTextWidth: 120,
      rightTextWidth: 110,
      leftIconWidth: 40,
      rightIconWidth: 40,
      shellNaturalWidth: 240,
      shellMinWidth: 96,
      endReserve: 36,
      iconOnly: false,
    })).toEqual({ iconOnly: false, shellMaxWidth: TOOLBAR_SHELL_MAX })
  })

  test('truncates the title before hiding button labels', () => {
    const fit = toolbarCapsuleFit({
      rowWidth: 520,
      leftTextWidth: 160,
      rightTextWidth: 150,
      leftIconWidth: 40,
      rightIconWidth: 40,
      shellNaturalWidth: 280,
      shellMinWidth: 100,
      endReserve: 36,
      iconOnly: false,
    })
    expect(fit.iconOnly).toBe(false)
    expect(fit.shellMaxWidth).toBe(132)
    expect(fit.shellMaxWidth).toBeLessThan(280)
    expect(fit.shellMaxWidth).toBeGreaterThanOrEqual(100)
  })

  test('drops to icons when the ring and fraction still would not fit', () => {
    const crowded = toolbarCapsuleFit({
      rowWidth: 420,
      leftTextWidth: 180,
      rightTextWidth: 170,
      leftIconWidth: 40,
      rightIconWidth: 40,
      shellNaturalWidth: 280,
      shellMinWidth: 140,
      endReserve: 36,
      iconOnly: false,
    })
    expect(crowded.iconOnly).toBe(true)
    expect(crowded.shellMaxWidth).toBe(252)
    expect(crowded.shellMaxWidth).toBeGreaterThanOrEqual(140)
  })

  test('does not restore labels until the text budget clears the minimum shell', () => {
    const base = {
      rowWidth: 800,
      leftTextWidth: 200,
      rightTextWidth: 295,
      leftIconWidth: 36,
      rightIconWidth: 36,
      shellNaturalWidth: 260,
      shellMinWidth: 120,
      endReserve: 36,
    }
    const textBudget = centeredShellBudget(base.rowWidth, base.leftTextWidth, base.rightTextWidth, base.endReserve, 8)
    expect(textBudget).toBe(122)
    expect(textBudget).toBeGreaterThanOrEqual(base.shellMinWidth)
    expect(textBudget).toBeLessThan(base.shellMinWidth + 4)
    expect(toolbarCapsuleFit({ ...base, iconOnly: true }).iconOnly).toBe(true)
    expect(toolbarCapsuleFit({ ...base, iconOnly: false }).iconOnly).toBe(false)
    const restored = toolbarCapsuleFit({ ...base, rightTextWidth: 286, iconOnly: true })
    expect(centeredShellBudget(800, 200, 286, 36, 8)).toBe(140)
    expect(restored.iconOnly).toBe(false)
  })

  test('the scroll button only spends width on the capsule\'s right', () => {
    const withButton = centeredShellBudget(600, 80, 80, 36, 8)
    const withoutButton = centeredShellBudget(600, 80, 80, 0, 8)
    expect(withoutButton - withButton).toBe(72)
  })
})
