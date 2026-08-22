import type {
  ArtifactRef,
  FinalizationCheck,
  FinalizationEvidence,
  OfficeResultEnvelope,
  OfficeStructuredError,
  StructuredWarning,
} from '../office-types.ts';

function slimWarning(warning: StructuredWarning): Record<string, unknown> {
  return {
    code: warning.code,
    message: warning.message,
    ...(warning.severity && warning.severity !== 'low' ? { severity: warning.severity } : {}),
    ...(warning.recovery ? { recovery: warning.recovery } : {}),
  };
}

function slimError(error: OfficeStructuredError): Record<string, unknown> {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    retriable: error.retriable,
    ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
    ...(error.recovery ? { recovery: error.recovery } : {}),
  };
}

function slimArtifacts(artifacts: ArtifactRef[]): Array<Record<string, unknown>> {
  return artifacts.map(artifact => ({
    kind: artifact.kind,
    path: artifact.path,
    ...(artifact.page ? { page: artifact.page } : {}),
  }));
}

function slimCheck(check: FinalizationCheck): Record<string, unknown> {
  return {
    name: check.name,
    blocking: check.blocking,
    ...(check.error ? { error: slimError(check.error) } : {}),
  };
}

function slimEvidence(evidence: FinalizationEvidence): Record<string, unknown> {
  const failed = evidence.checks.filter(check => !check.ok).map(slimCheck);
  return {
    profile: evidence.profile,
    artifactRevision: evidence.artifactRevision,
    failed,
  };
}

function slimData(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!('executionContract' in record) || !record.bootstrap || typeof record.bootstrap !== 'object') {
    return data;
  }
  const bootstrap = record.bootstrap as Record<string, unknown>;
  if (typeof bootstrap.content !== 'string') return data;
  const contract = typeof record.executionContract === 'string' ? record.executionContract : '';
  if (!contract || !bootstrap.content.startsWith(contract)) return data;
  return {
    ...record,
    bootstrap: {
      ...bootstrap,
      content: bootstrap.content.slice(contract.length).replace(/^\n+/, ''),
    },
  };
}

export function toOfficeModelFacingPayload(envelope: OfficeResultEnvelope): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ok: envelope.ok,
    command: envelope.command,
  };
  if (envelope.documentPath) payload.documentPath = envelope.documentPath;
  if (envelope.cwd) payload.cwd = envelope.cwd;
  if (envelope.cacheHit) payload.cacheHit = true;
  if (envelope.backend) payload.backend = envelope.backend;
  if (envelope.artifactRevision !== undefined) payload.artifactRevision = envelope.artifactRevision;
  if (envelope.deliveryReady !== undefined) payload.deliveryReady = envelope.deliveryReady;
  if (envelope.error) payload.error = slimError(envelope.error);
  if (envelope.warnings.length > 0) payload.warnings = envelope.warnings.map(slimWarning);
  if (envelope.data !== undefined) payload.data = slimData(envelope.data);
  if (envelope.evidence) payload.evidence = slimEvidence(envelope.evidence);
  if (envelope.artifacts.length > 0) payload.artifacts = slimArtifacts(envelope.artifacts);
  return payload;
}

export function officeModelFacingText(envelope: OfficeResultEnvelope): string {
  return JSON.stringify(toOfficeModelFacingPayload(envelope));
}
