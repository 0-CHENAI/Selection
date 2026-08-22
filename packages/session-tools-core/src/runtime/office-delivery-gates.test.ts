import { describe, expect, it } from 'bun:test';
import {
  isSkillFalsePositiveIssue,
  placeholderLeakCount,
  skillHeadingGateRequired,
  skillPageRequired,
  skillTocAndPageRequired,
  undersizedHeading1Count,
} from './office-delivery-gates.ts';

describe('office delivery gates', () => {
  it('counts official placeholder and escaped-token leaks', () => {
    expect(placeholderLeakCount('Title $TITLE$ and {{name}} <TODO> xxxx lorem \\$')).toBeGreaterThanOrEqual(5);
    expect(placeholderLeakCount('Body {var} ipsum placeholder this slide layout')).toBeGreaterThanOrEqual(4);
    expect(placeholderLeakCount('Quarterly report body')).toBe(0);
  });

  it('requires heading, TOC, and PAGE gates only for non-trivial Word outlines', () => {
    const threeHeadings = {
      paragraphs: 6,
      headings: [
        { text: '一', style: 'Heading1', level: 1 },
        { text: '二', style: 'Heading2', level: 2 },
        { text: '三', style: 'Heading3', level: 3 },
      ],
    };
    expect(skillHeadingGateRequired('.docx', { paragraphs: 2, headings: [] })).toBe(false);
    expect(skillHeadingGateRequired('.docx', { paragraphs: 6, headings: [] })).toBe(true);
    expect(skillHeadingGateRequired('.pptx', threeHeadings)).toBe(false);
    expect(skillTocAndPageRequired(threeHeadings)).toBe(true);
    expect(skillTocAndPageRequired({
      headings: [{ text: '目录', style: 'TOCHeading', level: 1 }, { text: '一', style: 'Heading1', level: 1 }],
    })).toBe(false);
    expect(skillPageRequired({ paragraphs: 2, headings: [{ text: '一', style: 'Heading1', level: 1 }] })).toBe(false);
    expect(skillPageRequired({ paragraphs: 10, headings: [{ text: '一', style: 'Heading1', level: 1 }] })).toBe(true);
    expect(skillPageRequired({ pages: 2, headings: [] })).toBe(true);
    expect(undersizedHeading1Count({
      headings: [{ text: '标题', style: 'Heading1', size: 11 }],
    })).toBe(1);
    expect(undersizedHeading1Count({
      headings: [{ text: '标题', style: 'Heading1', size: '18pt' }],
    })).toBe(0);
    expect(undersizedHeading1Count({
      matches: 1,
      results: [{
        type: 'paragraph',
        style: 'Heading1',
        format: { style: 'Heading1', size: '11pt' },
      }],
    })).toBe(1);
  });

  it('treats Word first-line indent findings as skill false positives', () => {
    expect(isSkillFalsePositiveIssue('.docx', {
      message: 'Cover title uses first-line indent',
      path: '/body/p[1]',
    })).toBe(true);
    expect(isSkillFalsePositiveIssue('.docx', {
      message: 'Missing alt text',
      path: '/body/p[1]',
    })).toBe(false);
    expect(isSkillFalsePositiveIssue('.pptx', {
      message: 'Cover title uses first-line indent',
    })).toBe(false);
  });
});
