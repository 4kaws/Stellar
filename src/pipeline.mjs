import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readJson, writeJson, sha256, runProcess, processStatus, runDirectory } from './common.mjs';
import { checkCatalog, checkCandidate, validateSpecifications, implementationSource, specificationSource } from './contracts.mjs';
import { evaluate } from '../trusted/oracles.mjs';
import { checkTrust, hashTree } from './trust.mjs';
import { toolchain } from './toolchain.mjs';
export { toolchain } from './toolchain.mjs';

export function classifyAudit(result) {
  if (processStatus(result) !== 'passed') return processStatus(result);
  const found = [...(result.stdout + result.stderr).matchAll(/Dafny auditor completed with (\d+) findings/g)];
  if (found.length !== 1) return 'unknown';
  return found[0][1] === '0' && !/Warning:|Error:/i.test(result.stdout + result.stderr) ? 'passed' : 'rejected';
}

export async function verifyDafny(file, tools, timeoutMs = 60000) {
  return runProcess(tools.dafny, ['verify', file, '--cores', '2', '--verification-time-limit', '15', '--solver-path', tools.solver, '--enforce-determinism'], { timeoutMs });
}

async function createPackage(directory, jsFile, catalog) {
  const packageDir = path.join(directory, 'package'); await mkdir(packageDir, { recursive: true });
  const generated = await readFile(jsFile, 'utf8');
  await writeFile(path.join(packageDir, 'verified.cjs'), generated + '\nmodule.exports = { Pilot, BigNumber };\n');
  const names = Object.fromEntries(catalog.components.map(c => [c.id, { name: c.name, arity: c.parameters.length }]));
  const wrapper = `'use strict';\nconst { Pilot, BigNumber } = require('./verified.cjs');\nconst definitions = ${JSON.stringify(names, null, 2)};\nconst api = {};\nfor (const [id, {name, arity}] of Object.entries(definitions)) {\n  api[id] = (...args) => {\n    if (args.length !== arity || args.some(x => typeof x !== 'string' || x.length > 200 || !/^(0|-?[1-9][0-9]*)$/.test(x))) {\n      throw new TypeError('Expected canonical decimal integer strings, at most 200 characters, with exact arity');\n    }\n    return Pilot.__default[name](...args.map(x => new BigNumber(x))).toFixed(0);\n  };\n}\nmodule.exports = Object.freeze(api);\n`;
  await writeFile(path.join(packageDir, 'index.cjs'), wrapper);
  await writeJson(path.join(packageDir, 'package.json'), { name: 'stellar-pilot-rules', version: catalog.policyVersion === 'v2' ? '2.0.0-pilot' : '1.0.0-pilot', main: 'index.cjs', private: true, license: '(MIT OR Apache-2.0)', description: 'Pilot package: consult the accompanying acceptance report and trust assumptions' });
  for (const name of ['LICENSE-MIT', 'LICENSE-APACHE', 'THIRD_PARTY_NOTICES.md']) await cp(path.join(ROOT, name), path.join(packageDir, name));
  await cp(path.join(ROOT, 'node_modules', 'bignumber.js'), path.join(packageDir, 'node_modules', 'bignumber.js'), { recursive: true });
  return packageDir;
}

export async function runPipeline({ candidateFile = path.join(ROOT, 'candidates', 'baseline.json'), policyVersion = 'v1', mode = 'full', timeoutMs = 60000, progress = () => {} } = {}) {
  if (!['full', 'formal', 'tests'].includes(mode) || !['v1', 'v2'].includes(policyVersion)) throw new Error('Unsupported policy or mode');
  const directory = await runDirectory(mode); const started = performance.now();
  const report = { schemaVersion: 1, kind: 'local-unsigned-pilot-evidence', status: 'blocked', mode, policyVersion, startedAt: new Date().toISOString(), checks: [], components: [], sourceHashes: {}, limitations: ['Policy defaults were authored for this pilot, not independently approved by a domain owner.', 'Proofs cover mathematical integer functions; host encoding, compiler, runtime and verifier remain trusted.', 'No OS sandbox or signature authority is provided; only restricted expression proposals are accepted.', 'Generation seeds are authored artifacts, not a controlled comparison of online model providers.'] };
  const check = (name, status, details = {}) => { report.checks.push({ name, status, ...details }); progress(`${name}: ${status}`); if (status !== 'passed') throw new Error(`${name}: ${status}`); };
  async function processCheck(name, result, status) {
    await writeFile(path.join(directory, `${name}.log`), result.stdout + '\n' + result.stderr);
    check(name, status ?? processStatus(result), { code: result.code, durationMs: result.durationMs, log: `${name}.log` });
  }
  try {
    report.trust = await checkTrust(); check('trust', 'passed');
    const catalogFile = path.join(ROOT, 'trusted', policyVersion === 'v1' ? 'catalog.json' : 'catalog-v2.json');
    const candidateBytes = await readFile(candidateFile); if (candidateBytes.length > 350000) throw new Error('Candidate bundle too large');
    const catalogBytes = await readFile(catalogFile);
    const catalog = checkCatalog(JSON.parse(catalogBytes));
    const candidate = JSON.parse(candidateBytes); const parsed = checkCandidate(candidate, catalog);
    report.label = candidate.label; check('candidate-policy', 'passed');
    await writeFile(path.join(directory, 'candidate.json'), candidateBytes); await writeFile(path.join(directory, 'catalog.json'), catalogBytes);
    const implementation = implementationSource(catalog, parsed); const specifications = specificationSource(catalog);
    await writeFile(path.join(directory, 'Implementation.dfy'), implementation); await writeFile(path.join(directory, 'SpecificationChecks.dfy'), specifications);
    for (const name of ['candidate.json', 'catalog.json', 'Implementation.dfy', 'SpecificationChecks.dfy']) report.sourceHashes[name] = sha256(await readFile(path.join(directory, name)));
    if (mode === 'full') {
      report.specificationTests = validateSpecifications(catalog, evaluate, policyVersion);
      check('specification-tests', 'passed', { positive: report.specificationTests.reduce((n, c) => n + c.positives, 0), negative: report.specificationTests.reduce((n, c) => n + c.negatives, 0), discarded: 0 });
    }
    const tools = await toolchain(); report.toolchain = { dafny: tools.version, solver: tools.configuration.dafny.solver.version, node: process.version, configurationHash: sha256(JSON.stringify(tools.configuration)) };
    if (mode === 'full') {
      const result = await verifyDafny(path.join(directory, 'SpecificationChecks.dfy'), tools, timeoutMs);
      await processCheck('specification-proofs', result, processStatus(result, { verification: true }));
    }
    if (mode !== 'tests') {
      const result = await verifyDafny(path.join(directory, 'Implementation.dfy'), tools, timeoutMs);
      await processCheck('implementation-proof', result, processStatus(result, { verification: true }));
    }
    if (mode === 'full') {
      const result = await runProcess(tools.dafny, ['audit', path.join(directory, 'Implementation.dfy')], { timeoutMs });
      await processCheck('assumption-audit', result, classifyAudit(result));
    }
    // Compilation deliberately reuses the exact already verified source; it is not a separate LLM rewrite.
    const build = await runProcess(tools.dafny, ['build', path.join(directory, 'Implementation.dfy'), '--target', 'js', '--output', path.join(directory, 'generated.js'), '--no-verify', '--enforce-determinism'], { timeoutMs });
    await processCheck('compilation', build);
    const packageDir = await createPackage(directory, path.join(directory, 'generated.js'), catalog);
    const testedPackageHashes = await hashTree(packageDir);
    const runtimeResult = path.join(directory, 'runtime-results.json');
    const runtime = await runProcess(process.execPath, [path.join(ROOT, 'src', 'runtime-check.mjs'), path.join(directory, 'catalog.json'), path.join(packageDir, 'index.cjs'), runtimeResult, policyVersion], { timeoutMs });
    if (processStatus(runtime) === 'passed') {
      const results = await readJson(runtimeResult); report.components = results.components ?? [];
      const complete = report.components.map(c => c.id).sort().join(',') === catalog.components.map(c => c.id).sort().join(',') && report.components.every(c => c.passed === 160 + catalog.components.find(s => s.id === c.id).cases.length && c.encodingChecks === 12);
      await processCheck('compiled-tests', runtime, results.status === 'passed' && complete && results.failureCount === 0 ? 'passed' : 'rejected');
    } else { try { report.runtimeFailure = await readJson(runtimeResult); } catch { /* process failure itself is evidence */ } await processCheck('compiled-tests', runtime); }
    for (const [name, digest] of Object.entries(report.sourceHashes)) if (sha256(await readFile(path.join(directory, name))) !== digest) throw new Error(`Source changed during checking: ${name}`);
    if (sha256(await readFile(candidateFile)) !== sha256(candidateBytes)) throw new Error('Candidate changed during checking');
    if ((await checkTrust()).digest !== report.trust.digest) throw new Error('Trust baseline changed during checking');
    await toolchain();
    check('binding', 'passed');
    report.packageHashes = await hashTree(packageDir);
    if (JSON.stringify(report.packageHashes) !== JSON.stringify(testedPackageHashes)) throw new Error('Package changed during testing');
    report.status = mode === 'full' ? 'accepted-for-pilot' : 'experiment-passed';
  } catch (error) { report.error = error.message; }
  report.durationMs = Math.round(performance.now() - started);
  const reportFile = path.join(directory, 'report.json'); await writeJson(reportFile, report);
  return { report, reportFile, directory };
}
