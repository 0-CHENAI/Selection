import { expect, test } from 'bun:test'
import { modelPickerPlacement } from '../model-picker-position'

test('keeps a long provider list above the trigger and bounds it to available space', () => {
  expect(modelPickerPlacement({ top: 321, bottom: 348 }, 1299)).toEqual({ side: 'top', maxHeight: 305 })
  expect(modelPickerPlacement({ top: 321, bottom: 348 }, 1299, 'top')).toEqual({ side: 'top', maxHeight: 305 })
})

test('opens below only when there is too little room above and stays there on resize', () => {
  expect(modelPickerPlacement({ top: 70, bottom: 98 }, 600)).toEqual({ side: 'bottom', maxHeight: 384 })
  expect(modelPickerPlacement({ top: 300, bottom: 328 }, 600, 'bottom')).toEqual({ side: 'bottom', maxHeight: 256 })
})

test('switches sides only when resizing or scrolling leaves too little space', () => {
  expect(modelPickerPlacement({ top: 60, bottom: 88 }, 600, 'top')).toEqual({ side: 'bottom', maxHeight: 384 })
  expect(modelPickerPlacement({ top: 510, bottom: 538 }, 600, 'bottom')).toEqual({ side: 'top', maxHeight: 384 })
  expect(modelPickerPlacement({ top: 150, bottom: 178 }, 600, 'top')).toEqual({ side: 'top', maxHeight: 134 })
})
