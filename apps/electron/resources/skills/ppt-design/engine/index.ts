export { CANVAS, DECK_VERSION, LAYOUT_IDS } from './types';
export type { Bounds, CheckReport, Deck, DeckIssue, LayoutId, Page, RenderResult, Theme } from './types';
export { parseDeck, assertDeck } from './schema';
export { checkDeck, assertCheck } from './check';
export { renderDeck, writePptx } from './export-pptx';
export { pageToSvg, writePagePreviews } from './preview';
export { loadDeckFile, loadStyleDeck, listBundledStyles, readDeckDocument, skillRoot } from './load';
export { buildStyleDeck, STYLE_IDS } from './library/catalog';
export { validateOutputPath, resolvedDirectory } from './paths';
