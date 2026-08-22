import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  validateCatalog,
  validateObservationFile,
  type BenchmarkCatalog,
  type Observation,
  type ObservationFile,
} from './check-officecli-benchmark.ts';

const catalogPath = resolve(import.meta.dir, '../benchmarks/officecli/tasks.json');
const catalogContents = readFileSync(catalogPath);
const catalog = JSON.parse(catalogContents.toString('utf8')) as BenchmarkCatalog;
const catalogHash = createHash('sha256').update(catalogContents).digest('hex');

function validObservation(taskId: string, iteration: number): Observation {
  return {
    taskId,
    iteration,
    model: 'fixed-model',
    promptHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    ok: true,
    officeToolCalls: 5,
    duplicateStatusHelpCalls: 0,
    nativeCommands: [{ command: ['get', 'document.docx', '/'], durationMs: 10 }],
    modelTotalDurationMs: 100,
    output: {
      exists: true,
      openable: true,
      validated: true,
      rendered: true,
      currentRevisionEvidence: true,
      deliveryReady: true,
    },
    internalGuideSkillEntries: 0,
    managementNetworkRequests: 0,
    manualMicrosoftOfficeGolden: 'not-run',
  };
}

function validFile(): ObservationFile {
  return {
    catalogHash,
    observations: catalog.tasks.flatMap(task => (
      Array.from({ length: catalog.repetitions }, (_, index) => validObservation(task.id, index + 1))
    )),
  };
}

describe('OfficeCLI benchmark governance', () => {
  it('locks the catalog to the reviewed manifest version', () => {
    expect(() => validateCatalog(catalog, '1.0.999')).toThrow('does not match manifest');
    expect(() => validateCatalog(catalog, '1.0.144')).not.toThrow();
  });

  it('accepts exactly one complete observation per task and repetition', () => {
    expect(validateObservationFile('after', validFile(), catalog, catalogHash).size)
      .toBe(catalog.tasks.length * catalog.repetitions);
  });

  it('rejects extra iterations, empty native evidence, and non-boolean gates', () => {
    const extra = validFile();
    extra.observations.push(validObservation(catalog.tasks[0]!.id, catalog.repetitions + 1));
    expect(() => validateObservationFile('after', extra, catalog, catalogHash)).toThrow('exactly');

    const emptyNative = validFile();
    emptyNative.observations[0]!.nativeCommands = [];
    expect(() => validateObservationFile('after', emptyNative, catalog, catalogHash)).toThrow('native command');

    const invalidGate = validFile();
    (invalidGate.observations[0]!.output as unknown as Record<string, unknown>).rendered = 'yes';
    expect(() => validateObservationFile('after', invalidGate, catalog, catalogHash)).toThrow('output evidence');
  });
});
