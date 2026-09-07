import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readJson, writeJson, sha256 } from './common.mjs';

export const lockPath = path.join(ROOT, 'trusted', 'baseline-lock.json');
async function protectedPaths() {
  const sources = (await readdir(path.join(ROOT, 'src'))).filter(f => f.endsWith('.mjs')).sort().map(f => `src/${f}`);
  return ['trusted/catalog.json', 'trusted/catalog-v2.json', 'trusted/oracles.mjs', 'toolchain.json', 'package.json', 'package-lock.json', '.gitattributes', 'scripts/setup-tools.ps1', 'LICENSE-MIT', 'LICENSE-APACHE', 'THIRD_PARTY_NOTICES.md', ...sources,
    'node_modules/bignumber.js/package.json', 'node_modules/bignumber.js/bignumber.js'];
}
export async function sealPilot() {
  const files = {};
  for (const name of await protectedPaths()) files[name] = sha256(await readFile(path.join(ROOT, name)));
  const lock = { schemaVersion: 1, provenance: 'Authored pilot defaults; not independent domain-owner certification', files };
  await writeJson(lockPath, lock); return { digest: sha256(JSON.stringify(lock)), files: Object.keys(files).length };
}
export async function checkTrust() {
  const lock = await readJson(lockPath);
  const expected = await protectedPaths();
  if (lock.schemaVersion !== 1 || !lock.files || Object.keys(lock.files).sort().join('\n') !== expected.sort().join('\n')) throw new Error('Trust lock file coverage changed; review and explicitly reseal the pilot');
  for (const [name, digest] of Object.entries(lock.files)) {
    if (sha256(await readFile(path.join(ROOT, name))) !== digest) throw new Error(`Trusted input changed: ${name}`);
  }
  return { digest: sha256(JSON.stringify(lock)), provenance: lock.provenance };
}

export async function hashTree(directory, prefix = '') {
  const output = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in release packages');
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(output, await hashTree(path.join(directory, entry.name), relative));
    else if (entry.isFile()) output[relative] = sha256(await readFile(path.join(directory, entry.name)));
    else throw new Error('Unexpected release file type');
  }
  return output;
}

export async function inspectReceipt(reportFile) {
  const report = await readJson(reportFile);
  if (report.schemaVersion !== 1 || report.status !== 'accepted-for-pilot' || report.mode !== 'full' || !Array.isArray(report.checks) || !Array.isArray(report.components) || report.components.length !== 20) throw new Error('Receipt does not contain full pilot acceptance');
  const required = ['trust', 'candidate-policy', 'specification-tests', 'specification-proofs', 'implementation-proof', 'assumption-audit', 'compilation', 'compiled-tests', 'binding'];
  if (report.checks.length !== required.length || required.some(name => report.checks.filter(c => c.name === name).length !== 1 || report.checks.find(c => c.name === name)?.status !== 'passed')) throw new Error('Mandatory release evidence is missing or ambiguous');
  if (!report.sourceHashes || Object.keys(report.sourceHashes).sort().join(',') !== ['candidate.json', 'catalog.json', 'Implementation.dfy', 'SpecificationChecks.dfy'].sort().join(',')) throw new Error('Receipt source coverage is incomplete');
  if (!['v1', 'v2'].includes(report.policyVersion) || Object.values(report.sourceHashes).some(hash => !/^[0-9a-f]{64}$/.test(hash))) throw new Error('Receipt policy or source hashes are invalid');
  const catalog = await readJson(path.join(ROOT, 'trusted', report.policyVersion === 'v1' ? 'catalog.json' : 'catalog-v2.json'));
  const expectedIds = catalog.components.map(c => c.id).sort().join(',');
  if (report.components.map(c => c.id).sort().join(',') !== expectedIds || report.components.some(c => c.passed !== 160 + catalog.components.find(spec => spec.id === c.id)?.cases.length || c.encodingChecks !== 12)) throw new Error('Receipt component coverage is incomplete');
  const currentTrust = await checkTrust();
  if (report.trust.digest !== currentTrust.digest) throw new Error('Receipt is stale against the current trusted baseline');
  const directory = path.dirname(reportFile);
  for (const [name, digest] of Object.entries(report.sourceHashes)) {
    if (!['candidate.json', 'catalog.json', 'Implementation.dfy', 'SpecificationChecks.dfy'].includes(name)) throw new Error('Unexpected receipt source path');
    if (sha256(await readFile(path.join(directory, name))) !== digest) throw new Error(`Receipt artifact changed: ${name}`);
  }
  const hashes = await hashTree(path.join(directory, 'package'));
  if (JSON.stringify(hashes) !== JSON.stringify(report.packageHashes)) throw new Error('Compiled package no longer matches receipt');
  return { status: 'integrity-matches', note: 'Local unsigned evidence integrity only; this does not authenticate receipts supplied by other parties.', components: report.components.length };
}
