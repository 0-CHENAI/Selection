/** Phrase-aware heading wrap. Avoids a lone last CJK character such as 街/区. */

const FULLWIDTH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff00-\uffef]/u;
const CLOSING = /^[，。！？；：、）》】”’]%?$/u;
const OPENING = /^[（《【“‘]$/u;

/** Common two-character compounds that must stay on one line when wrapping titles. */
const KEEP = new Set([
  '街区', '城市', '热岛', '试点', '方案', '降温', '更新', '路线', '遮阴', '透水',
  '社区', '协作', '观测', '评估', '维护', '责任', '预算', '步行', '体验', '对照',
  '复测', '基线', '扩展', '原则', '居民', '学校', '车站', '高温', '暴露', '时间',
  '设计', '系统', '材料', '证据', '结论', '方法', '研究', '报告', '数据', '图表',
  '建议', '核对', '检验', '结果', '清单', '节点', '幅度', '目标',
]);

export function charUnits(character: string): number {
  if (FULLWIDTH.test(character)) return 1.08;
  if (/[MW@%]/.test(character)) return 0.9;
  return 0.61;
}

export function textUnits(text: string): number {
  let units = 0;
  for (const character of text) units += charUnits(character);
  return units;
}

export function lineCapacity(widthCm: number, sizePt: number): number {
  return widthCm * 72 / 2.54 / sizePt;
}

export function tokenizeHeading(text: string): string[] {
  const chars = [...text];
  const raw: string[] = [];
  for (let i = 0; i < chars.length;) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      let end = i + 1;
      while (end < chars.length && /\s/.test(chars[end])) end++;
      raw.push(chars.slice(i, end).join(''));
      i = end;
      continue;
    }
    if (FULLWIDTH.test(ch)) {
      const pair = ch + (chars[i + 1] ?? '');
      if (chars[i + 1] && KEEP.has(pair)) {
        raw.push(pair);
        i += 2;
        continue;
      }
      raw.push(ch);
      i++;
      continue;
    }
    let end = i + 1;
    while (end < chars.length && !FULLWIDTH.test(chars[end]) && !/\s/.test(chars[end])) end++;
    raw.push(chars.slice(i, end).join(''));
    i = end;
  }
  const tokens: string[] = [];
  for (const token of raw) {
    if (CLOSING.test(token) && tokens.length > 0) tokens[tokens.length - 1] += token;
    else tokens.push(token);
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    if (OPENING.test(tokens[i])) {
      tokens[i + 1] = tokens[i] + tokens[i + 1];
      tokens.splice(i, 1);
      i--;
    }
  }
  return tokens;
}

function pack(tokens: string[], capacity: number): string[] {
  const lines: string[] = [];
  let current = '';
  let units = 0;
  for (const token of tokens) {
    const next = textUnits(token);
    if (current && units + next > capacity + 0.02) {
      lines.push(current);
      current = token.replace(/^\s+/, '');
      units = textUnits(current);
    } else {
      current += token;
      units += next;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function cjkChars(text: string): number {
  return [...text].filter(ch => FULLWIDTH.test(ch)).length;
}

function stealOrphans(lines: string[]): string[] {
  const result = [...lines];
  for (let i = result.length - 1; i > 0; i--) {
    while (cjkChars(result[i]) > 0 && cjkChars(result[i]) < 2 && cjkChars(result[i - 1]) > 2) {
      const tokens = tokenizeHeading(result[i - 1]);
      if (tokens.length < 2) break;
      const moved = tokens.pop();
      if (!moved) break;
      const remaining = tokens.join('').trimEnd();
      if (cjkChars(remaining) > 0 && cjkChars(remaining) < 2) break;
      result[i - 1] = remaining;
      result[i] = moved + result[i];
    }
  }
  return result.filter((line, index) => line.length > 0 || index === 0);
}

export function wrapHeading(text: string, widthCm: number, sizePt: number): string {
  const capacity = lineCapacity(widthCm, sizePt);
  const wrapped = text.split(/\r\n|\r|\n/).map(paragraph => {
    if (!paragraph.trim()) return paragraph;
    if (textUnits(paragraph) <= capacity) return paragraph;
    return stealOrphans(pack(tokenizeHeading(paragraph), capacity)).join('\n');
  });
  return wrapped.join('\n');
}

export function shouldWrapText(name: string, value: string, heading: boolean): boolean {
  if (!heading) return false;
  if (/^(section-number|value|page|mark)$/.test(name) || /(^|-)num-/.test(name)) return false;
  return /[\p{Script=Han}]/u.test(value) || value.length > 18;
}
