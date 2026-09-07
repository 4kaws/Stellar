import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectReceipt } from '../src/trust.mjs';

const catalog = JSON.parse(readFileSync(new URL('../trusted/catalog.json', import.meta.url), 'utf8'));
const mandatoryChecks = ['trust', 'candidate-policy', 'specification-tests', 'specification-proofs', 'implementation-proof', 'assumption-audit', 'compilation', 'compiled-tests', 'binding'];
const sourceFiles = ['candidate.json', 'catalog.json', 'Implementation.dfy', 'SpecificationChecks.dfy'];

function receipt() {
  return {
    schemaVersion: 1,
    kind: 'local-unsigned-pilot-evidence',
    status: 'accepted-for-pilot',
    mode: 'full',
    policyVersion: 'v1',
    checks: mandatoryChecks.map((name) => ({ name, status: 'passed' })),
    components: catalog.components.map((component) => ({ id: component.id, passed: 160 + component.cases.length, encodingChecks: 12 })),
    sourceHashes: Object.fromEntries(sourceFiles.map((name) => [name, '0'.repeat(64)])),
    trust: { digest: '0'.repeat(64) },
    packageHashes: {},
  };
}

// These fixtures deliberately have no artifact files or package. A malformed
// receipt must be rejected by its own evidence checks, before reading artifacts
// or consulting the mutable repository trust baseline.
async function rejectsReceipt(mutate, expected) {
  const value = receipt();
  mutate(value);
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'stellar-receipt-test-'));
  const file = path.join(directory, 'report.json');
  try {
    await writeFile(file, JSON.stringify(value));
    await assert.rejects(inspectReceipt(file), expected);
  } finally {
    // Verify the exact generated directory is a direct child of the intended
    // temp directory before recursive cleanup, including on Windows.
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.ok(path.basename(directory).startsWith('stellar-receipt-test-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('receipt requires the complete full-acceptance envelope', async () => {
  const mutations = [
    (r) => { r.schemaVersion = 2; },
    (r) => { delete r.schemaVersion; },
    (r) => { r.status = 'blocked'; },
    (r) => { r.status = 'experiment-passed'; },
    (r) => { r.mode = 'tests'; },
    (r) => { r.mode = 'formal'; },
    (r) => { r.checks = {}; },
    (r) => { r.components = {}; },
    (r) => { r.components.pop(); },
    (r) => { r.components.push({ ...r.components[0] }); },
  ];
  for (const mutate of mutations) await rejectsReceipt(mutate, /Receipt does not contain full pilot acceptance/);
});

test('every mandatory gate must have exactly one passed evidence record', async () => {
  for (const name of mandatoryChecks) {
    await rejectsReceipt((r) => {
      r.checks = r.checks.filter((check) => check.name !== name);
    }, /Mandatory release evidence is missing or ambiguous/);
    for (const status of ['unknown', 'rejected', 'skipped', 'failed']) {
      await rejectsReceipt((r) => {
        r.checks.find((check) => check.name === name).status = status;
      }, /Mandatory release evidence is missing or ambiguous/);
    }
  }
});

test('duplicate evidence cannot substitute for a missing mandatory check', async () => {
  await rejectsReceipt((r) => {
    r.checks[0] = { ...r.checks[1] };
  }, /Mandatory release evidence is missing or ambiguous/);
});

test('conflicting duplicate and unexpected gate records are rejected', async () => {
  await rejectsReceipt((r) => {
    r.checks.push({ name: 'implementation-proof', status: 'rejected' });
  }, /Mandatory release evidence is missing or ambiguous/);
  await rejectsReceipt((r) => {
    r.checks[0] = { name: 'unrecognized-check', status: 'passed' };
  }, /Mandatory release evidence is missing or ambiguous/);
});

test('all four bound source artifacts must be named', async () => {
  await rejectsReceipt((r) => { delete r.sourceHashes; }, /Receipt source coverage is incomplete/);
  await rejectsReceipt((r) => { r.sourceHashes = {}; }, /Receipt source coverage is incomplete/);
  for (const name of sourceFiles) {
    await rejectsReceipt((r) => { delete r.sourceHashes[name]; }, /Receipt source coverage is incomplete/);
  }
});

test('unexpected and traversal source paths cannot be read through a receipt', async () => {
  await rejectsReceipt((r) => { r.sourceHashes['extra.json'] = '0'.repeat(64); }, /Receipt source coverage is incomplete/);
  await rejectsReceipt((r) => {
    delete r.sourceHashes['candidate.json'];
    r.sourceHashes['../candidate.json'] = '0'.repeat(64);
  }, /Receipt source coverage is incomplete/);
});

test('source bindings require canonical SHA-256 digests', async () => {
  for (const value of ['', '0'.repeat(63), '0'.repeat(65), 'A'.repeat(64), 'z'.repeat(64), null, 42]) {
    await rejectsReceipt((r) => { r.sourceHashes['candidate.json'] = value; }, /Receipt policy or source hashes are invalid/);
  }
});

test('receipt cannot select an unknown policy or a filesystem path as a policy', async () => {
  for (const version of [undefined, null, 'v3', '../catalog', 'V1']) {
    await rejectsReceipt((r) => { r.policyVersion = version; }, /Receipt policy or source hashes are invalid/);
  }
});

test('twenty entries must cover twenty distinct trusted component identities', async () => {
  await rejectsReceipt((r) => { r.components[0] = { ...r.components[1] }; }, /Receipt component coverage is incomplete/);
  await rejectsReceipt((r) => { r.components[0].id = 'unreviewed-rule'; }, /Receipt component coverage is incomplete/);
  await rejectsReceipt((r) => { delete r.components[0].id; }, /Receipt component coverage is incomplete/);
});

test('compiled sample counts must match the complete required suite exactly', async () => {
  const required = 160 + catalog.components[0].cases.length;
  for (const count of [undefined, 0, 1, required - 1, required + 1, -1, 1.5, String(required)]) {
    await rejectsReceipt((r) => { r.components[0].passed = count; }, /Receipt component coverage is incomplete/);
  }
});

test('all twelve package encoding and arity checks are required for every component', async () => {
  for (const count of [undefined, 0, 11, 13, '12']) {
    await rejectsReceipt((r) => { r.components[0].encodingChecks = count; }, /Receipt component coverage is incomplete/);
  }
});
