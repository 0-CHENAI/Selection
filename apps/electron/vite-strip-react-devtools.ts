/** Packaged `file:` windows used to inject the standalone React DevTools script. */

const DEVTOOLS_SCRIPT = /<script\b[^>]*>[\s\S]*?localhost:8097[\s\S]*?<\/script>\s*/gi

export function stripReactDevtoolsHtml(html: string): string {
  return html
    .replace(DEVTOOLS_SCRIPT, '')
    .replace(/ http:\/\/localhost:8097/g, '')
    .replace(/ ws:\/\/localhost:8097/g, '')
}
