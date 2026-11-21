import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfficeTurnTiming } from './office-stage-timing'

test('reports model, Office tool and delivery stages without logging paths, inputs or results', () => {
  const root = mkdtempSync(join(tmpdir(), 'office-stage-'))
  try {
    let now = 0
    const timing = new OfficeTurnTiming(false, root, root, () => now)
    const bash = (id: string, command: string) => timing.observe({ type: 'tool_start', toolName: 'Bash', toolUseId: id, input: { command } })
    const result = (id: string) => timing.observe({ type: 'tool_result', toolUseId: id, result: 'private output', isError: false })

    timing.observe({ type: 'model_call_start' })
    now = 100
    bash('edit', 'officecli set "private spreadsheet.xlsx" --prop "cell=private text"')
    writeFileSync(join(root, 'private spreadsheet.xlsx'), 'private document')
    now = 230
    result('edit')
    bash('validate', 'officecli validate "private spreadsheet.xlsx"')
    now = 255
    result('validate')
    timing.observe({ type: 'tool_start', toolName: 'mcp__session__xlsx_recalculate', toolUseId: 'recalc',
      input: { path: 'private spreadsheet.xlsx' } })
    now = 300
    result('recalc')
    timing.observe({ type: 'tool_start', toolName: 'office_render', toolUseId: 'render',
      input: { path: 'private spreadsheet.xlsx' } })
    now = 410
    result('render')
    now = 430
    timing.deliveryGate(410, true)
    const summary = timing.finish()
    expect(summary).toEqual({
      durationMs: 430,
      incompleteToolCount: 0,
      stages: [
        { phase: 'model_wait', type: 'model', durationMs: 100, fileChanged: false },
        { phase: 'tool', type: 'officecli:set', durationMs: 130, fileChanged: true },
        { phase: 'validation', type: 'officecli:validate', durationMs: 25, fileChanged: false },
        { phase: 'recompute', type: 'xlsx_recalculate', durationMs: 45, fileChanged: false },
        { phase: 'readback_render', type: 'office_render', durationMs: 110, fileChanged: false },
        { phase: 'delivery_gate', type: 'office_delivery_guard', durationMs: 20, fileChanged: true },
      ],
    })
    expect(JSON.stringify(summary)).not.toContain('private')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('omits non-Office turns and does not assign a compound shell duration to individual commands', () => {
  let now = 0
  const timing = new OfficeTurnTiming(false, '/', '/', () => now)
  timing.observe({ type: 'tool_start', toolName: 'Bash', toolUseId: 'echo', input: { command: 'echo "officecli validate sample.docx"' } })
  timing.observe({ type: 'tool_result', toolUseId: 'echo', result: '', isError: false })
  timing.deliveryGate(0, false)
  expect(timing.finish()).toBeUndefined()

  timing.observe({ type: 'tool_start', toolName: 'Bash', toolUseId: 'compound',
    input: { command: 'officecli close sample.docx && officecli validate sample.docx && officecli get another.docx /body/p[1]' } })
  now = 400
  timing.observe({ type: 'tool_result', toolUseId: 'compound', result: '', isError: true })
  expect(timing.finish()?.stages).toEqual([
    { phase: 'tool', type: 'officecli:shell', durationMs: 400, fileChanged: null, commandTypes: ['close', 'validate', 'get'] },
  ])
})

test('labels variable-expanded shell commands without guessing which file changed', () => {
  let now = 0
  const timing = new OfficeTurnTiming(false, '/', '/', () => now)
  timing.observe({ type: 'tool_start', toolName: 'Bash', toolUseId: 'batch',
    input: { command: 'officecli batch "$FILE" --input "$BATCH" --json' } })
  now = 30
  timing.observe({ type: 'tool_result', toolUseId: 'batch', result: '', isError: false })
  expect(timing.finish()?.stages).toEqual([
    { phase: 'tool', type: 'officecli:shell', durationMs: 30, fileChanged: null, commandTypes: ['batch'] },
  ])
})

test('times direct and indirect deck-cli screenshots without splitting compound shell time', () => {
  let now = 0
  const timing = new OfficeTurnTiming(false, '/', '/', () => now)
  const run = (toolUseId: string, command: string, duration: number) => {
    timing.observe({ type: 'tool_start', toolName: 'Bash', toolUseId, input: { command } })
    now += duration
    timing.observe({ type: 'tool_result', toolUseId, result: '', isError: false })
  }
  run('echo', 'echo \'bun engine/deck-cli.mjs screenshot anything.pptx\'', 1)
  run('check', 'bun engine/deck-cli.mjs check deck.json', 1)
  run('heredoc-data', "cat <<'EOF'\nbun engine/deck-cli.mjs screenshot anything.pptx\nEOF", 1)
  expect(timing.finish()).toBeUndefined()

  run('direct', 'bun engine/deck-cli.mjs screenshot home.pptx --out slides --pages 5', 100)
  run('indirect', 'cd data && sleep 3 && cat ppt-output.json && "$CRAFT_BUN" "engine/deck-cli.mjs" screenshot "$FILE" --out "$PWD/slides" --pages 5; echo EXIT=$?', 500)
  run('readback', 'cd data && OFFICECLI_SKIP_UPDATE=1 "$CRAFT_BUN" engine/deck-cli.mjs screenshot home.pptx --out "$PWD/slides" --pages 5 >/dev/null && OFFICECLI_SKIP_UPDATE=1 officecli view home.pptx text 2>&1 | head -5', 200)
  run('mixed', 'officecli validate home.pptx && node engine/deck-cli.mjs screenshot home.pptx --out slides --pages 5', 300)
  run('heredoc', 'OFFICECLI_SKIP_UPDATE=1 "$CRAFT_BUN" engine/deck-cli.mjs screenshot home.pptx | head; python3 - <<\'EOF\'\nprint("inspect screenshots")\nEOF', 400)
  expect(timing.finish()?.stages).toEqual([
    { phase: 'readback_render', type: 'deck-cli:screenshot', durationMs: 100, fileChanged: false },
    { phase: 'readback_render', type: 'deck-cli:shell', durationMs: 500, fileChanged: null, commandTypes: ['screenshot'] },
    { phase: 'readback_render', type: 'deck-cli:shell', durationMs: 200, fileChanged: null, commandTypes: ['screenshot'] },
    { phase: 'tool', type: 'deck-cli:shell', durationMs: 300, fileChanged: null, commandTypes: ['screenshot'] },
    { phase: 'tool', type: 'deck-cli:shell', durationMs: 400, fileChanged: null, commandTypes: ['screenshot'] },
  ])
})
