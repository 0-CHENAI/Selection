import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PendingAnnotationIndices } from '../../../context/PendingAnnotationIndices'
import { AnnotationOverlayLayer } from '../AnnotationOverlayLayer'

it('uses composer numbering across messages and falls back to local numbering outside the composer', () => {
  const indices = new Map([['second', new Map([['annotation', 2]])]])
  const render = (messageId: string) => renderToStaticMarkup(
    <PendingAnnotationIndices.Provider value={indices}>
      <AnnotationOverlayLayer messageId={messageId} rects={[]}
        chips={[{ id: 'annotation', index: 1, left: 10, top: 10 }]} onChipOpen={() => {}} />
    </PendingAnnotationIndices.Provider>,
  )
  expect(render('second')).toContain('data-ca-annotation-index="2"')
  expect(render('first')).toContain('data-ca-annotation-index="1"')
})
