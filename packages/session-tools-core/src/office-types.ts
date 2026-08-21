/** Stable Selection-facing Office tool protocol. */

export type OfficeErrorCategory =
  | 'input'
  | 'path'
  | 'permission'
  | 'runtime'
  | 'dependency'
  | 'timeout'
  | 'conflict'
  | 'unsupported';

export interface OfficeStructuredError {
  code: string;
  category: OfficeErrorCategory;
  message: string;
  upstreamCode?: string;
  retriable: boolean;
  recovery?: string;
}

export interface StructuredWarning {
  code: string;
  message: string;
  severity?: 'low' | 'medium' | 'high';
  recovery?: string;
}

export interface ArtifactRef {
  kind: 'document' | 'image' | 'html' | 'pdf' | 'resource' | 'evidence';
  path: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  page?: string;
  artifactRevision?: number;
}

export interface FinalizationCheck {
  name: string;
  ok: boolean;
  blocking: boolean;
  data?: unknown;
  warnings?: StructuredWarning[];
  error?: OfficeStructuredError;
}

export interface FinalizationEvidence {
  file: string;
  profile: 'standard' | 'strict';
  artifactRevision: number;
  generatedAt: string;
  backend?: string;
  checks: FinalizationCheck[];
}

export interface OfficeResultEnvelope extends Record<string, unknown> {
  ok: boolean;
  version: string;
  schemaCrc: string;
  command: string[];
  cwd: string;
  documentPath?: string;
  durationMs: number;
  data?: unknown;
  backend?: string;
  warnings: StructuredWarning[];
  cacheHit: boolean;
  artifactRevision?: number;
  artifacts: ArtifactRef[];
  evidence?: FinalizationEvidence;
  deliveryReady?: boolean;
  error?: OfficeStructuredError;
}

export type OfficeGuideName =
  | 'word'
  | 'excel'
  | 'pptx'
  | 'academic-paper'
  | 'financial-model'
  | 'data-dashboard'
  | 'pitch-deck'
  | 'word-form'
  | 'morph-ppt'
  | 'morph-ppt-3d';

export interface OfficecliManifestAsset {
  name: string;
  url: string;
  sha256: string;
}

export interface OfficecliManifestGuide {
  directory: string;
  entry: string;
  contentHash: string;
  resourceHash: string;
  inherits: OfficeGuideName[];
}

export interface OfficecliExternalDependency {
  id: string;
  version: string;
  license: string;
  networkRequiredFor: string[];
  fallback: string;
  hosts: string[];
}

export interface OfficecliManifest {
  manifestVersion: number;
  version: string;
  tag: string;
  tagCommit: string;
  schemaCrc: string;
  sourceRepository: string;
  license: {
    spdx: string;
    licenseFile: string;
    licenseSha256: string;
    noticeFile: string;
    noticeSha256: string;
  };
  assets: Record<string, OfficecliManifestAsset>;
  commandPolicy: {
    read: string[];
    edit: string[];
    preview: string[];
    lifecycle: string[];
    admin: string[];
  };
  commandSchema?: {
    file: string;
    sha256: string;
    unclassifiedCommands: string[];
    staleClassifications: string[];
  };
  guideIndex?: {
    file: string;
    sha256: string;
  };
  externalDependencies: OfficecliExternalDependency[];
  guides: Record<OfficeGuideName, OfficecliManifestGuide>;
}
