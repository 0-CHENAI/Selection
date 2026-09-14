import type { ThoughtDocument } from './types.ts';
import { thoughtGroupBounds } from './editing.ts';

function fenced(value: string, language = ''): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}${language}\n${value}\n${fence}`;
}

/** Portable text report. Full document metadata and original binaries belong to the bundle. */
export function workbenchMarkdown(document: ThoughtDocument): string {
  const lines = ['# Selection', '', fenced(document.title), '', `Document: ${document.id} · Revision: ${document.revision}`];
  for (const node of document.nodes) {
    lines.push('', `## ${node.id}`, '', fenced(node.title || node.question), '',
      `Kind: ${node.kind} · Mode: ${node.mode} · Archived: ${node.archived}`, '',
      '### Question', '', fenced(node.question), '', '### Answer', '', fenced(node.answer));
    if (node.source) lines.push('', '### Source', '', fenced(JSON.stringify(node.source, null, 2), 'json'));
    for (const material of node.materials) lines.push('', '### Material', '', fenced(JSON.stringify({ ...material, text: undefined, pages: undefined }, null, 2), 'json'), '', fenced(material.text));
    if (node.highlights.length) lines.push('', `### Highlights (${node.highlightMode})`, '', fenced(node.highlights.join('\n\n')));
    for (const version of node.versions) lines.push('', `### Version ${version.id}${version.id === node.activeVersionId ? ' (active)' : ''}`, '',
      fenced(JSON.stringify({ ...version, question: undefined, answer: undefined }, null, 2), 'json'), '', fenced(version.question), '', fenced(version.answer));
  }
  lines.push('', '## Relationships', '', fenced(JSON.stringify(document.edges, null, 2), 'json'));
  if (document.groups?.length) lines.push('', '## Groups', '', fenced(JSON.stringify(document.groups, null, 2), 'json'));
  if (document.executionYaml) lines.push('', '## Execution definition', '', fenced(document.executionYaml, 'yaml'));
  return lines.join('\n') + '\n';
}

const xml = (text: string) => text
  // XML 1.0 forbids control characters and unpaired surrogates even in text.
  .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '\uFFFD')
  .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));

/** Self-contained vector image: no scripts, foreignObject, external fonts or remote media. */
export function workbenchSvg(document: ThoughtDocument): string {
  const width = 260, height = 124, padding = 40;
  const collapsed = new Set(document.groups?.filter(group => group.collapsed).flatMap(group => group.nodeIds) ?? []);
  let minX = 0, minY = 0, maxX = width, maxY = height;
  for (const node of document.nodes) {
    if (collapsed.has(node.id)) continue;
    minX = Math.min(minX, node.position.x); minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width); maxY = Math.max(maxY, node.position.y + height);
  }
  const groups = (document.groups ?? []).map(group => {
    const bounds = thoughtGroupBounds(document, group.nodeIds);
    const groupWidth = group.collapsed ? 280 : bounds.width + 20;
    const groupHeight = group.collapsed ? 64 : bounds.height + 24;
    minX = Math.min(minX, bounds.x); minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + groupWidth); maxY = Math.max(maxY, bounds.y + groupHeight);
    return `<g><rect x="${bounds.x}" y="${bounds.y}" width="${groupWidth}" height="${groupHeight}" rx="12" fill="#e2e8f0" stroke="#94a3b8" stroke-dasharray="6 4"/><text x="${bounds.x + 12}" y="${bounds.y + 24}" font-size="12">${xml(group.title)} (${group.nodeIds.length})</text></g>`;
  }).join('');
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const edges = document.edges.map(edge => {
    const a = nodes.get(edge.source), b = nodes.get(edge.target);
    if (!a || !b || collapsed.has(a.id) || collapsed.has(b.id)) return '';
    return `<path d="M ${a.position.x + width / 2} ${a.position.y + height} L ${b.position.x + width / 2} ${b.position.y}" fill="none" stroke="#64748b"${edge.kind === 'reference' ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#arrow)"><title>${xml(`${edge.source} → ${edge.target} · ${edge.kind} · ${edge.depth} · ${edge.order}`)}</title></path>`;
  }).join('');
  const cards = document.nodes.map(node => {
    if (collapsed.has(node.id)) return '';
    const title = [...(node.title || node.question || node.id)].slice(0, 24).join('');
    const excerpt = [...(node.answer || node.question)].slice(0, 64).join('');
    const chunks = [...excerpt];
    const rows = [chunks.slice(0, 32).join(''), chunks.slice(32).join('')];
    return `<g transform="translate(${node.position.x} ${node.position.y})"${node.archived ? ' opacity="0.5"' : ''}><title>${xml(`${node.title}\n${node.question}\n${node.answer}`)}</title><rect width="${width}" height="${height}" rx="12" fill="#ffffff" stroke="#94a3b8"/><text x="14" y="26" font-size="14" font-weight="600">${xml(title)}</text><text x="14" y="47" fill="#64748b" font-size="10">${xml(node.kind + ' · ' + node.mode)}</text>${rows.map((row, i) => `<text x="14" y="${72 + i * 18}" font-size="11">${xml(row)}</text>`).join('')}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - padding} ${minY - padding - 28} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2 + 28}" font-family="sans-serif" fill="#0f172a"><title>${xml(document.title || 'Selection')}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs><rect x="${minX - padding}" y="${minY - padding - 28}" width="100%" height="100%" fill="#f8fafc"/><text x="${minX}" y="${minY - 20}" font-size="16">Selection</text>${groups}${edges}${cards}</svg>`;
}
