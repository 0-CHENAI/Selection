/** Browser-safe workbench document. Executable definitions remain TaskSpec documents. */
export interface ThoughtMaterial {
  id: string;
  name: string;
  mimeType: string;
  /** Workspace document-owned blob, never an arbitrary filesystem path. */
  digest: string;
  text: string;
  page?: number;
  size?: number;
  pages?: Array<{ page: number; text: string }>;
  selection?: { materialId: string; page?: number; start: number; end: number };
}

export interface ThoughtVersion {
  origin?: 'model' | 'manual';
  id: string;
  question: string;
  answer: string;
  contextHash: string;
  model: string;
  createdAt: string;
  status: 'completed' | 'interrupted' | 'failed';
  sessionId?: string;
}

export interface ThoughtNode {
  id: string;
  kind: 'question' | 'note' | 'material' | 'result';
  title: string;
  question: string;
  answer: string;
  mode: 'question' | 'agent';
  model?: string;
  llmConnection?: string;
  role?: string;
  archived: boolean;
  highlights: string[];
  highlightMode: 'off' | 'filter' | 'tag';
  materials: ThoughtMaterial[];
  excludedMaterialIds: string[];
  versions: ThoughtVersion[];
  activeVersionId?: string;
  position: { x: number; y: number };
  source?: { sessionId?: string; messageId?: string; taskSlug?: string; runId?: string; revision?: number; nodeId?: string; attempt?: number };
}

export interface ThoughtEdge {
  id: string;
  source: string;
  target: string;
  kind: 'context' | 'reference';
  order: number;
  depth: 'quote' | 'full';
}

export interface ThoughtDocument {
  groups?: Array<{ id: string; title: string; nodeIds: string[]; collapsed: boolean }>;
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  projectId?: string;
  taskSlug?: string;
  taskEtag?: string;
  executionYaml?: string;
  /** Recovery marker committed atomically with proposal application. */
  lastAppliedProposalId?: string;
  archived: boolean;
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
  updatedAt: string;
}

export interface CompiledThoughtContext {
  /** Full resolved input returned by the runtime (empty tools for Question mode). */
  agentInput?: import('../agent/pi-turn-input.ts').AgentInputSnapshot;
  /** Project identity affects session context and inherited model configuration. */
  projectId?: string;
  systemPrompt: string;
  prompt: string;
  documentId: string;
  revision: number;
  targetId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string; nodeId: string; materialId?: string }>;
  /** Material bytes are addressed by digest; same-size replacement changes the hash. */
  materials: ThoughtMaterial[];
  model?: string;
  llmConnection?: string;
  mode: ThoughtNode['mode'];
  hash: string;
}

export function newThoughtNode(id: string, position = { x: 0, y: 0 }): ThoughtNode {
  return { id, kind: 'question', title: '', question: '', answer: '', mode: 'question', archived: false,
    highlights: [], highlightMode: 'off', materials: [], excludedMaterialIds: [], versions: [], position };
}

export function newThoughtDocument(id: string): ThoughtDocument {
  return { schemaVersion: 1, id, revision: 0, title: '', archived: false, nodes: [], edges: [], updatedAt: new Date().toISOString() };
}

export type WorkbenchRequest =
  | { action: 'replays'; id: string }
  | { action: 'startReplay'; id: string; expectedRevision: number; nodeIds: string[] }
  | { action: 'replay' | 'cancelReplay'; id: string; replayId: string }
  | { action: 'reviseAnswer'; id: string; nodeId: string; expectedRevision: number; answer: string }
  | { action: 'exportBundle'; id: string }
  | { action: 'importBundle'; bundle: unknown }
  | { action: 'list' }
  | { action: 'get'; id: string }
  | { action: 'save'; document: ThoughtDocument; expectedRevision: number }
  | { action: 'compile'; id: string; nodeId: string }
  | { action: 'generate'; id: string; nodeId: string; expectedRevision: number; contextHash: string; inputHash?: string }
  | { action: 'cancel'; generationId: string }
  | { action: 'generation'; generationId: string }
  | { action: 'generations'; id: string; nodeId?: string }
  | { action: 'proposals'; id: string }
  | { action: 'executionSources'; id: string; nodeId: string }
  | { action: 'applyProposal' | 'discardProposal'; id: string; proposalId: string }
  | { action: 'importSession'; id: string; expectedRevision: number; sessionId: string; messageIds?: string[] }
  | { action: 'importResult'; id: string; expectedRevision: number; taskSlug: string; runId: string; nodeId: string }
  | { action: 'importMaterial'; id: string; expectedRevision: number; nodeId?: string; name: string; mimeType: string; base64: string; text: string; pages?: Array<{ page: number; text: string }> }
  | { action: 'readMaterial'; id: string; materialId: string }
  | { action: 'quoteMaterial'; id: string; expectedRevision: number; materialId: string; page?: number; start: number; end: number };

/** Immutable authoring baseline. Recording dialogue never increments the graph revision. */
export interface WorkbenchProposalBaseline {
  documentId: string;
  documentRevision: number;
  executionHash: string;
  taskEtag?: string;
  nodeIds: string[];
}

export interface WorkbenchProposal {
  id: string;
  baseline: WorkbenchProposalBaseline;
  goal: string;
  context: string;
  currentYaml: string;
  createdAt: string;
  sessionId?: string;
  status: 'generating' | 'ready' | 'failed' | 'applied' | 'discarded';
  yaml?: string;
  error?: string;
  appliedRevision?: number;
  /** Execution nodes added or changed using baseline.nodeIds as proposal context.
   * This records context provenance, not a model claim of semantic causation. */
  executionNodeIds?: string[];
}

export interface ThoughtGeneration {
  id: string;
  /** Imported receipt: sessionId is provenance, not a local navigation target. */
  detached?: boolean;
  /** Historical execution mode, independent of the node's current mode. */
  mode?: 'question' | 'agent';
  /** Monotonic durable receipt sequence; legacy receipts start at zero. */
  sequence?: number;
  /** Absent only on legacy receipts; never infer a historical execution time. */
  createdAt?: string;
  documentId: string;
  nodeId: string;
  sessionId: string;
  contextHash: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  answer?: string;
  /** Unconfirmed streaming text. Never use as a committed answer or context. */
  preview?: string;
  /** Agent progress only; excluded from answer versions and compiled context. */
  processText?: string;
  error?: string;
}

export interface ThoughtReplay {
  id: string;
  documentId: string;
  nodeIds: string[];
  completedNodeIds: string[];
  generationId?: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  error?: string;
}

export interface WorkbenchResult {
  replays?: ThoughtReplay[];
  executionSources?: Array<{ proposalId: string; appliedRevision: number; thoughtNodeIds: string[] }>;
  replay?: ThoughtReplay;
  bundle?: import('./bundle.ts').WorkbenchBundle;
  material?: ThoughtMaterial;
  base64?: string;
  proposals?: WorkbenchProposal[];
  proposal?: WorkbenchProposal;
  documents?: ThoughtDocument[];
  document?: ThoughtDocument | null;
  context?: CompiledThoughtContext;
  generation?: ThoughtGeneration;
  generations?: ThoughtGeneration[];
}
