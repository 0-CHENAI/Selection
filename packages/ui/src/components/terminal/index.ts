/**
 * Terminal output components for displaying command results.
 */

export { TerminalOutput, type TerminalOutputProps, type ToolType } from './TerminalOutput'
export {
  parseAnsi,
  stripAnsi,
  readableAnsiForeground,
  isUnreadableTerminalText,
  isGrepContentOutput,
  parseGrepOutput,
  ANSI_COLORS,
  type AnsiSpan,
  type GrepLine,
} from './ansi-parser'
