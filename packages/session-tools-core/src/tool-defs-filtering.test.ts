import { describe, expect, it } from 'bun:test';
import {
  SESSION_TOOL_DEFS,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
} from './tool-defs.ts';

describe('session tool filtering helpers', () => {
  it('respects developer feedback filtering and keeps names/registry aligned', () => {
    expect(getSessionToolDefs({ includeDeveloperFeedback: false }).map(def => def.name))
      .not.toContain('send_developer_feedback');
    expect(getSessionToolDefs({ includeDeveloperFeedback: true }).map(def => def.name))
      .toContain('send_developer_feedback');

    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    const registry = getSessionToolRegistry({ includeDeveloperFeedback: false });
    for (const name of names) expect(registry.has(name)).toBe(true);
    expect(registry.has('send_developer_feedback')).toBe(false);
  });

  it('does not register native Office document tools', () => {
    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    for (const name of [
      'office_document_inspect',
      'office_document_edit',
      'office_document_guide',
      'office_document_preview',
      'office_document_finalize',
    ]) {
      expect(names.has(name)).toBe(false);
    }
  });

  it('omits all typed OfficeCLI tools when the feature/runtime gate is closed', () => {
    const disabled = getSessionToolNames({ includeOfficecliTools: false });
    expect(disabled.has('officecli_batch')).toBe(false);
    expect(disabled.has('officecli_qa')).toBe(false);
    expect(disabled.has('officecli_finalize')).toBe(false);

    const enabled = getSessionToolNames({ includeOfficecliTools: true });
    expect(enabled.has('officecli_batch')).toBe(true);
    expect(enabled.has('officecli_qa')).toBe(true);
    expect(enabled.has('officecli_finalize')).toBe(true);
  });

  it('all canonical session tools declare safeMode metadata', () => {
    for (const def of SESSION_TOOL_DEFS) {
      expect(def.safeMode === 'allow' || def.safeMode === 'block').toBe(true);
    }
  });

  it('keeps OfficeCLI research and QA available in Safe mode while blocking document writes', () => {
    const allowed = getSessionSafeAllowedToolNames({ includeOfficecliTools: true });
    const blocked = getSessionSafeBlockedToolNames({ includeOfficecliTools: true });
    expect(allowed.has('officecli_qa')).toBe(true);
    expect(blocked.has('officecli_batch')).toBe(true);
    expect(blocked.has('officecli_finalize')).toBe(true);
  });
});
