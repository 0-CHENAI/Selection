import { expect, it } from 'bun:test';
import { createRequestDiagnosticScope, runWithRequestDiagnostics, beginRequestDiagnostic, requestDiagnosticDetails } from './request-diagnostics';

it('isolates concurrent invocations and prevents late retry callbacks from replacing current failure', async () => {
  const first = createRequestDiagnosticScope();
  const second = createRequestDiagnosticScope();
  await Promise.all([runWithRequestDiagnostics(first, async () => {
    const old = beginRequestDiagnostic(); old({ phase: 'provider-error', requestId: 'old' });
    const current = beginRequestDiagnostic(); current({ phase: 'transport-error' });
    await Bun.sleep(1);
    old({ phase: 'eof', requestId: 'old' });
  }), runWithRequestDiagnostics(second, async () => {
    await Bun.sleep(1);
    beginRequestDiagnostic()({ phase: 'provider-error', requestId: 'second', httpStatus: 200 });
  })]);
  expect(first.latest).toMatchObject({ attempt: 2, phase: 'transport-error' });
  expect(first.latest?.providerRequestId).toBeUndefined();
  expect(second.latest).toMatchObject({ attempt: 1, providerRequestId: 'second' });
  expect(first.latest?.invocationId).not.toBe(second.latest?.invocationId);
});
it('does not retain arbitrary provider payload fields', () => {
  const scope = createRequestDiagnosticScope();
  runWithRequestDiagnostics(scope, () => beginRequestDiagnostic()({ phase: 'provider-error', secret: 'secret', requestId: 'Bearer secret' }));
  expect(requestDiagnosticDetails(scope).join()).not.toContain('secret');
});
it('does not replay fetch after an already dispatched request fails', async () => {
  const interceptor = new URL('./unified-network-interceptor.ts', import.meta.url).pathname;
  const diagnostic = new URL('./request-diagnostics.ts', import.meta.url).pathname;
  const script = `
    import { createRequestDiagnosticScope, runWithRequestDiagnostics } from ${JSON.stringify(diagnostic)};
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('private endpoint failure'); };
    await import(${JSON.stringify(interceptor)} + '?fault-test=' + Date.now());
    const scope = createRequestDiagnosticScope();
    try { await runWithRequestDiagnostics(scope, () => fetch('http://localhost/v1/chat/completions', { method: 'POST', body: JSON.stringify({model:'local',messages:[]}) })); } catch {}
    console.log(JSON.stringify({calls, diagnostic:scope.latest}));
  `;
  const proc = Bun.spawn([process.execPath, '--eval', script], { env: { ...process.env, CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0' }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(code, stderr).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.calls).toBe(1);
  expect(result.diagnostic).toMatchObject({ attempt: 1, phase: 'transport-error' });
  expect(stdout).not.toContain('private endpoint');
});

it('distinguishes pre-output failure from a stream interrupted after output', () => {
  const scope = createRequestDiagnosticScope();
  runWithRequestDiagnostics(scope, () => {
    const report = beginRequestDiagnostic();
    report({ phase: 'first-bytes' }); report({ phase: 'first-output' });
    report({ phase: 'transport-error' }); report({ phase: 'cancelled' });
  });
  expect(scope.latest?.firstByteMs).toBeNumber();
  expect(scope.latest?.firstOutputMs).toBeNumber();
  expect(scope.latest?.phase).toBe('transport-error');
});
