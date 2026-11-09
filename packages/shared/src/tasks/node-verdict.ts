export interface TaskNodeVerdict {
  result: 'pass' | 'fail';
  reason?: string;
  nodes?: string[];
  evidence?: string;
  nodeId?: string;
}

export interface NodeVerdictOk {
  ok: true;
  verdict: Required<Pick<TaskNodeVerdict, 'result'>> & TaskNodeVerdict;
}

export interface NodeVerdictErr {
  ok: false;
  error: string;
}

export function validateTaskNodeVerdict(payload: TaskNodeVerdict): NodeVerdictOk | NodeVerdictErr {
  if (payload.result !== 'pass' && payload.result !== 'fail') {
    return { ok: false, error: 'result must be pass or fail' };
  }
  if (payload.result === 'fail') {
    if (!payload.reason?.trim()) return { ok: false, error: 'fail verdict requires a reason' };
    if (!payload.evidence?.trim()) return { ok: false, error: 'fail verdict requires evidence' };
    if (!payload.nodes?.length) return { ok: false, error: 'fail verdict requires nodes to rework' };
  }
  return { ok: true, verdict: payload };
}
