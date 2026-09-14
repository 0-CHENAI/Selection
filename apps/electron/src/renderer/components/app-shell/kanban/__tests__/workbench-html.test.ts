import { expect, it } from 'bun:test'
import { extractWorkbenchHtml } from '../workbench-html'

it('extracts ordered readable text without scripts, styles or embedded documents', () => {
  const text = extractWorkbenchHtml('<head><title>not body</title></head><h1>Title</h1><script>secret()</script><style>hidden</style><iframe src="https://invalid.example">embedded</iframe><p>中文 &amp; <b>bold</b></p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')
  expect(text).toBe('Title\n中文 & bold\nA\tB\t\n1\t2\t\n')
})

it('handles deeply nested materials without recursive traversal overflow', () => {
  expect(extractWorkbenchHtml('<div>'.repeat(12000) + 'deep content' + '</div>'.repeat(12000)).trim()).toBe('deep content')
})
