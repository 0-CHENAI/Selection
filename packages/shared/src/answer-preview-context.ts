import { AsyncLocalStorage } from 'node:async_hooks';

export type AnswerPreviewObserver = (preview: { toolCallId: string; text: string }) => void;
// The interceptor preload and bundled subprocess must share the same context.
const key = Symbol.for('selection.answer-preview-context');
const shared = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<AnswerPreviewObserver> };
export const answerPreviewContext = shared[key] ??= new AsyncLocalStorage<AnswerPreviewObserver>();
