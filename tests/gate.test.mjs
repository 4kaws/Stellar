import test from 'node:test';
import assert from 'node:assert/strict';
import { processStatus, runProcess } from '../src/common.mjs';
import { classifyAudit } from '../src/pipeline.mjs';

const successSummary = 'Dafny program verifier finished with 20 verified, 0 errors\n';
const result = overrides => ({
  code: 0, stdout: '', stderr: '', timedOut: false, overflow: false,
  error: null, durationMs: 1, ...overrides,
});
const verifiedStatus = overrides => processStatus(result(overrides), { verification: true });

test('ordinary process success requires a zero exit and no execution uncertainty', () => {
  assert.equal(processStatus(result({ stdout: 'compiled successfully' })), 'passed');
  assert.equal(processStatus(result({ code: 1 })), 'rejected');
  assert.equal(processStatus(result({ code: 2, stdout: successSummary })), 'rejected');
  for (const uncertainty of [
    { code: null }, { timedOut: true }, { overflow: true }, { error: 'spawn failed' },
    { stdout: 'verification timed out' }, { stderr: 'INCONCLUSIVE result' },
    { stderr: 'solver out of resource' },
  ]) assert.equal(processStatus(result(uncertainty)), 'unknown', JSON.stringify(uncertainty));
});

test('formal verification requires explicit successful proof evidence', () => {
  assert.equal(verifiedStatus({ stdout: successSummary }), 'passed');
  assert.equal(verifiedStatus({ stderr: successSummary }), 'passed');
  assert.equal(verifiedStatus({}), 'unknown');
  assert.equal(verifiedStatus({ stdout: 'Compilation completed successfully.' }), 'unknown');
  assert.notEqual(verifiedStatus({ stdout: 'Dafny program verifier finished with 0 verified, 0 errors' }), 'passed');
  assert.notEqual(verifiedStatus({ stdout: 'Dafny program verifier finished with 19 verified, 1 error' }), 'passed');
  assert.notEqual(verifiedStatus({ stdout: 'Dafny program verifier finished with 18 verified, 2 errors' }), 'passed');
  assert.notEqual(verifiedStatus({ stdout: 'User message: 20 verified, 0 errors' }), 'passed');
});

test('success text cannot override timeout, incomplete proofs, or contradictory proof summaries', () => {
  for (const uncertainty of [
    { timedOut: true }, { overflow: true }, { error: 'stream failed' }, { code: null },
    { stderr: 'One proof was inconclusive' }, { stderr: 'One assertion timed out' },
  ]) assert.equal(verifiedStatus({ stdout: successSummary, ...uncertainty }), 'unknown');
  assert.equal(verifiedStatus({ stdout: successSummary, code: 1 }), 'rejected');
  assert.notEqual(verifiedStatus({ stdout: successSummary + 'Dafny program verifier finished with 1 verified, 1 error\n' }), 'passed');
  assert.notEqual(verifiedStatus({ stdout: successSummary + successSummary }), 'passed');
});

test('audit success requires a zero-finding summary without warnings or errors', () => {
  assert.equal(classifyAudit(result({ stdout: 'Dafny auditor completed with 0 findings\n' })), 'passed');
  assert.equal(classifyAudit(result({ stderr: 'Dafny auditor completed with 0 findings\n' })), 'passed');
  assert.equal(classifyAudit(result({ stdout: 'Dafny auditor completed with 1 findings\n' })), 'rejected');
  assert.equal(classifyAudit(result({ stdout: 'Dafny auditor completed with 12 findings\n' })), 'rejected');
  assert.equal(classifyAudit(result({ stdout: 'Dafny auditor completed with 0 findings\n', stderr: 'Warning: untrusted assumption' })), 'rejected');
  assert.equal(classifyAudit(result({ stdout: 'Dafny auditor completed with 0 findings\n', stderr: 'Error: audit failed' })), 'rejected');
  assert.equal(classifyAudit(result({})), 'unknown');
  assert.equal(classifyAudit(result({ stdout: 'Audit started; no final result is available.' })), 'unknown');
});

test('an audit cannot pass on ambiguous summaries or failed process execution', () => {
  const summary = 'Dafny auditor completed with 0 findings\n';
  for (const uncertainty of [{ timedOut: true }, { overflow: true }, { code: null }, { error: 'spawn failed' }]) {
    assert.equal(classifyAudit(result({ stdout: summary, ...uncertainty })), 'unknown');
  }
  assert.equal(classifyAudit(result({ stdout: summary, code: 1 })), 'rejected');
  assert.equal(classifyAudit(result({ stdout: summary, stderr: 'analysis inconclusive' })), 'unknown');
  assert.notEqual(classifyAudit(result({ stdout: summary + 'Dafny auditor completed with 1 findings\n' })), 'passed');
  assert.notEqual(classifyAudit(result({ stdout: summary + summary })), 'passed');
});

test('a real subprocess timeout terminates execution and produces unknown status', { timeout: 10000 }, async () => {
  const timed = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 150 });
  assert.equal(timed.timedOut, true);
  assert.equal(processStatus(timed), 'unknown');
  assert.ok(timed.durationMs >= 100, `deadline fired prematurely at ${timed.durationMs} ms`);
  assert.ok(timed.durationMs < 8000, `timed-out process took ${timed.durationMs} ms to terminate`);
});

test('a real successful subprocess preserves stdout, stderr, and its exit status', { timeout: 10000 }, async () => {
  const completed = await runProcess(process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("err");'], { timeoutMs: 3000 });
  assert.equal(completed.code, 0);
  assert.equal(completed.stdout, 'out');
  assert.equal(completed.stderr, 'err');
  assert.equal(completed.timedOut, false);
  assert.equal(processStatus(completed), 'passed');
});
