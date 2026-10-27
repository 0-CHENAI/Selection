import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkippedImagesNote } from '../../config/model-image-support.ts';
import { imageAttachmentUnsupportedMessage } from '../llm-tool.ts';
import { runPreToolUseChecks } from '../core/pre-tool-use.ts';
import {
  PPT_VISUAL_QA_NO_OCR_NOTE,
  assertPptVisualQaTool,
  isNativeSlideVisionCall,
  pptVisualQaMissingNativeVision,
  pptVisualQaViolation,
} from '../ppt-visual-qa-policy.ts';

const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url));

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

const screenshot = {
  toolName: 'Bash',
  input: {
    command: 'officecli view "/tmp/项目介绍.pptx" screenshot --page 1 -o "/tmp/slides/slide-01.png"',
  },
};

describe('PPT visual QA cannot use OCR', () => {
  it('blocks the recurring Swift OCR New Pages steps', () => {
    for (const displayName of [
      'Swift: OCR New Pages 1-4',
      'Swift: OCR New Pages 5-9',
      'OCR New Pages 10-13',
      'Swift：OCR 新页 1-4',
    ]) {
      const input = { command: 'swift /tmp/read.swift', _displayName: displayName };
      const reason = pptVisualQaViolation('Bash', input);
      expect(reason).toContain('imageInput');
      expect(reason).toContain('call_llm');
      expect(reason).toContain(PPT_VISUAL_QA_NO_OCR_NOTE);
      expect(() => assertPptVisualQaTool('Bash', input)).toThrow(/call_llm/);
    }
  });

  it('matches the block to whether this model can see images', () => {
    const input = { command: 'tesseract /tmp/slides/slide-01.png stdout' };
    const enabled = pptVisualQaViolation('Bash', input, undefined, true);
    const unavailable = pptVisualQaViolation('Bash', input, undefined, false);
    expect(enabled).toContain('imageInput: enabled');
    expect(enabled).toContain('call_llm');
    expect(enabled).not.toContain('image_capability_mismatch');
    expect(unavailable).toContain('imageInput: unavailable');
    expect(unavailable).toContain('image_capability_mismatch');
    expect(unavailable).toContain(PPT_VISUAL_QA_NO_OCR_NOTE);
    expect(unavailable).not.toContain('请用 Read');
  });

  it('blocks OCR engines and Vision scripts aimed at slide images', () => {
    const blocked = [
      { command: 'tesseract "/tmp/slides/slide-01.png" stdout', _displayName: 'Read text' },
      { command: 'sudo tesseract /data/slides/slide-1.png stdout' },
      { command: 'python -m pytesseract "/tmp/page-03.png"' },
      { command: 'python ocr_pages.py /data/slides/slide-02.png' },
      { command: 'env SWIFT_BIN=swift swift -e \'import Vision\nlet request = VNRecognizeTextRequest()\' /tmp/slides/slide-01.png' },
      { command: 'paddleocr --image /tmp/deck/slide-04.png' },
    ];
    for (const input of blocked) {
      expect(pptVisualQaViolation('Bash', input)).toContain('image_capability_mismatch');
    }
  });

  it('blocks writing or running a Swift OCR script whose target is a slide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppt-ocr-'));
    try {
      const script = join(dir, 'read.swift');
      writeFileSync(script, 'import Vision\nlet request = VNRecognizeTextRequest()\nlet path = "slides/slide-01.png"\n');
      expect(pptVisualQaViolation('Bash', { command: `swift ${script}` })).toContain('不要改用 OCR');
      expect(pptVisualQaViolation('Write', {
        path: join(dir, 'ocr.swift'),
        contents: 'import Vision\nlet request = VNRecognizeTextRequest()\n// slide-02.png\n',
      })).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks an OCR skill used on slide images and a step labeled as slide OCR', () => {
    expect(pptVisualQaViolation('Skill', {
      skill: 'pdf-ocr',
      args: 'slides/slide-01.png',
    })).toBeTruthy();
    expect(pptVisualQaViolation('call_llm', {
      prompt: 'Look at the pixels',
      attachments: ['/tmp/slides/slide-01.png'],
      _displayName: 'OCR New Pages 1-4',
    })).toBeTruthy();
    expect(pptVisualQaViolation('Bash', {
      command: 'echo ok',
    }, { displayName: 'Swift: OCR New Pages 1-4' })).toBeTruthy();
  });

  it('keeps scanned-document OCR, screenshots, and native vision available', () => {
    expect(pptVisualQaViolation('Bash', {
      command: 'tesseract "/tmp/contract.pdf" stdout',
      _displayName: 'OCR scanned contract',
    })).toBeNull();
    expect(pptVisualQaViolation('Bash', { command: 'swift test' })).toBeNull();
    expect(pptVisualQaViolation('Bash', { command: 'swift build' })).toBeNull();
    expect(pptVisualQaViolation('Bash', { command: 'python make_deck.py' })).toBeNull();
    expect(pptVisualQaViolation('Bash', screenshot.input)).toBeNull();
    expect(pptVisualQaViolation('Bash', { command: 'officecli view "/tmp/deck.pptx" text' })).toBeNull();
    expect(pptVisualQaViolation('Write', {
      path: '/tmp/deck.json',
      contents: '{"title":"我们不做 OCR","pages":[]}',
    })).toBeNull();
    expect(pptVisualQaViolation('Write', {
      path: '/tmp/visual-review.md',
      contents: `# notes\nimport Vision\nVNRecognizeTextRequest\nslide-01.png\n${PPT_VISUAL_QA_NO_OCR_NOTE}`,
    })).toBeNull();

    const read = { path: '/tmp/slides/slide-01.png' };
    expect(pptVisualQaViolation('Read', read)).toBeNull();
    expect(isNativeSlideVisionCall('Read', read)).toBe(true);

    const vision = {
      prompt: `Check overlap and contrast.\n${PPT_VISUAL_QA_NO_OCR_NOTE}`,
      attachments: ['/tmp/slides/slide-02.png'],
      _displayName: 'Read slide 2',
    };
    expect(pptVisualQaViolation('mcp__session__call_llm', vision)).toBeNull();
    expect(isNativeSlideVisionCall('mcp__session__call_llm', vision)).toBe(true);
    expect(isNativeSlideVisionCall('call_llm', { prompt: 'summarize', attachments: ['/tmp/notes.md'] })).toBe(false);
  });

  it('requires a native vision step after slide screenshots', () => {
    const ocr = {
      toolName: 'Bash',
      input: { command: 'swift /tmp/ocr.swift', _displayName: 'Swift: OCR New Pages 1-4' },
    };
    expect(pptVisualQaMissingNativeVision([screenshot, ocr])).toBe(true);
    expect(pptVisualQaMissingNativeVision([screenshot])).toBe(true);
    expect(pptVisualQaMissingNativeVision([
      screenshot,
      { toolName: 'Read', input: { file_path: '/tmp/slides/slide-01.png' } },
    ])).toBe(false);
    expect(pptVisualQaMissingNativeVision([
      screenshot,
      { toolName: 'call_llm', input: { prompt: 'Check layout', attachments: [{ path: '/tmp/slides/slide-01.png' }] } },
    ])).toBe(false);
    expect(pptVisualQaMissingNativeVision([
      { toolName: 'Bash', input: { command: 'officecli view "/tmp/deck.pptx" text' } },
    ])).toBe(false);
  });

  it('rejects the OCR step in the tool pipeline and still allows image call_llm', () => {
    const blocked = runPreToolUseChecks({
      toolName: 'Bash',
      input: { command: 'swift /tmp/ocr.swift', _displayName: 'OCR New Pages 5-9' },
      sessionId: 'ppt-visual',
      permissionMode: 'allow-all',
      workspaceRootPath: '/tmp',
      workspaceId: 'workspace',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager: {
        isCommandWhitelisted: () => { throw new Error('permission check should not run'); },
        isDangerousCommand: () => false,
        getBaseCommand: command => command,
        extractDomainFromNetworkCommand: () => null,
        isDomainWhitelisted: () => false,
      },
    });
    expect(blocked.type).toBe('block');
    if (blocked.type === 'block') expect(blocked.reason).toContain('attachments');

    const allowed = runPreToolUseChecks({
      toolName: 'call_llm',
      input: {
        prompt: 'Check the slide layout',
        attachments: ['/tmp/slides/slide-01.png'],
        _displayName: 'Read slide 1',
      },
      sessionId: 'ppt-visual-allow',
      permissionMode: 'allow-all',
      workspaceRootPath: '/tmp',
      workspaceId: 'workspace',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager: {
        isCommandWhitelisted: () => true,
        isDangerousCommand: () => false,
        getBaseCommand: command => command,
        extractDomainFromNetworkCommand: () => null,
        isDomainWhitelisted: () => false,
      },
    });
    expect(allowed.type).not.toBe('block');
    expect(allowed.type).toBe('call_llm_intercept');
  });

  it('tells a model that cannot see images not to fall back to OCR', () => {
    expect(buildSkippedImagesNote(2)).toContain(PPT_VISUAL_QA_NO_OCR_NOTE);
    expect(imageAttachmentUnsupportedMessage(0, 'deepseek-chat')).toContain('vision is not enabled for this model');
    expect(imageAttachmentUnsupportedMessage(0, 'deepseek-chat')).toContain(PPT_VISUAL_QA_NO_OCR_NOTE);
    expect(imageAttachmentUnsupportedMessage(0, 'Laufry')).not.toContain('Selection Backend mode');
  });

  it('locks the native-vision rule into the prompt, skills, and call_llm guide', () => {
    const sessionState = readRepo('packages/shared/src/agent/mode-manager.ts');
    expect(sessionState).toContain('imageInput: enabled');
    expect(sessionState).toContain('imageInput: unavailable');
    expect(sessionState).toContain('image_capability_mismatch');
    expect(sessionState).toContain('call_llm attachments');

    for (const path of [
      'apps/electron/resources/skills/ppt-design/SKILL.md',
      'apps/electron/resources/skills/ppt-design/references/visual-review.md',
      'apps/electron/resources/skills/ppt-design/references/workflow.md',
      'apps/electron/resources/skills/officecli/SKILL.md',
      'apps/electron/resources/skills/officecli/ppt-selection-override.md',
      'apps/electron/resources/docs/llm-tool.md',
    ]) {
      const body = readRepo(path);
      expect(body).toContain(PPT_VISUAL_QA_NO_OCR_NOTE);
      expect(body).toContain('imageInput');
      expect(body).toContain('image_capability_mismatch');
      expect(body.toLowerCase()).toContain('call_llm');
    }
    expect(readRepo('apps/electron/resources/docs/llm-tool.md')).not.toContain('images + OAuth');
  });
});
