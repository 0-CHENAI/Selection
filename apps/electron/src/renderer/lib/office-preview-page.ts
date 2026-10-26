export const OFFICE_PREVIEW_SHOW_PAGE = 'selection-office-show-page'

export interface OfficePreviewPageRequest {
  sessionId: string
  path: string
  page: number
}

export interface PinnedOfficePage {
  path: string
  page: number
}

export function requestOfficePreviewPage(request: OfficePreviewPageRequest): void {
  if (!Number.isInteger(request.page) || request.page < 1 || request.page > 500 || !request.path) return
  window.dispatchEvent(new CustomEvent(OFFICE_PREVIEW_SHOW_PAGE, { detail: request }))
}

export function slideNumberFromOfficePath(path: string | undefined): number | undefined {
  const match = /^\/slide\[(\d+)\]/.exec(path ?? '')
  if (!match) return undefined
  const page = Number(match[1])
  return page >= 1 && page <= 500 ? page : undefined
}

/** Drop the pin once the person scrolls to a different slide. */
export function pinnedPageAfterScroll(pin: PinnedOfficePage | undefined, anchorPath: string | undefined): PinnedOfficePage | undefined {
  if (!pin) return undefined
  const visible = slideNumberFromOfficePath(anchorPath)
  if (visible && visible !== pin.page) return undefined
  return pin
}

export function previewDocumentPage(pin: PinnedOfficePage | undefined, path: string | undefined): number | undefined {
  if (!pin || !path || pin.path !== path) return undefined
  return pin.page
}

/** Iframe bridge. Queues a page until the first scroll restore, then reveals `.main > .slide-container`. */
export function officePreviewPageBridge(page: number | null): string {
  const requested = page != null && Number.isInteger(page) && page >= 1 && page <= 500 ? String(page) : 'null'
  return `const requestedPage = ${requested};
  let queuedPage = requestedPage;
  const revealPage = (page) => {
    const n = Number(page);
    if (!Number.isInteger(n) || n < 1 || n > 500) return;
    const main = document.querySelector('.main');
    let slide = null;
    if (main) {
      for (const el of main.children) {
        if (el.classList && el.classList.contains('slide-container') && el.getAttribute('data-slide') === String(n)) { slide = el; break; }
      }
    }
    if (!slide) slide = document.querySelector('[data-path="/slide[' + n + ']"]');
    if (!slide) {
      const prefix = '/slide[' + n + ']/';
      slide = [...document.querySelectorAll('[data-path]')].find(el => (el.getAttribute('data-path') || '').startsWith(prefix)) || null;
    }
    if (slide && slide.scrollIntoView) slide.scrollIntoView({ block: 'start', inline: 'nearest' });
  };
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== '${OFFICE_PREVIEW_SHOW_PAGE}') return;
    if (!restored) { queuedPage = data.page; return; }
    revealPage(data.page);
  });`
}
