import path from 'node:path';
import { cp, writeFile, readFile } from 'node:fs/promises';
import { ROOT, readJson, writeJson, runDirectory, processStatus, runProcess } from './common.mjs';
import { checkCatalog, checkCandidate, validateSpecifications, specificationSource, equivalenceSource } from './contracts.mjs';
import { runPipeline, toolchain, verifyDafny, classifyAudit } from './pipeline.mjs';
import { inspectReceipt } from './trust.mjs';
import { evaluate } from '../trusted/oracles.mjs';

const candidate = name => path.join(ROOT, 'candidates', `${name}.json`);
const short = run => ({ status: run.report.status, reportFile: path.relative(ROOT, run.reportFile).split(path.sep).join('/'), durationMs: run.report.durationMs, components: run.report.components.length, error: run.report.error ?? null });

export async function runEvolution({ baseline, progress = () => {} } = {}) {
  const directory = await runDirectory('evolution');
  const catalog = checkCatalog(await readJson(path.join(ROOT, 'trusted', 'catalog.json')));
  baseline ??= await runPipeline({ progress });
  const refactor = await runPipeline({ candidateFile: candidate('refactor'), progress });
  const v2 = await runPipeline({ candidateFile: candidate('requirements-v2'), policyVersion: 'v2', progress });
  const tools = await toolchain();
  const before = checkCandidate(await readJson(candidate('baseline')), catalog);
  const after = checkCandidate(await readJson(candidate('refactor')), catalog);
  const file = path.join(directory, 'RefactorEquivalence.dfy');
  await writeFile(file, equivalenceSource(catalog, before, after));
  const proof = await verifyDafny(file, tools); await writeFile(path.join(directory, 'equivalence.log'), proof.stdout + proof.stderr);
  const v2Catalog = await readJson(path.join(ROOT, 'trusted', 'catalog-v2.json'));
  const changes = v2Catalog.components.map(c => {
    const witness = c.cases.find(t => evaluate(c.id, t.args.map(BigInt), 'v1') !== evaluate(c.id, t.args.map(BigInt), 'v2'));
    return { id: c.id, changed: Boolean(witness), witness: witness?.args, before: witness ? evaluate(c.id, witness.args.map(BigInt), 'v1').toString() : null, after: witness ? evaluate(c.id, witness.args.map(BigInt), 'v2').toString() : null };
  });
  const report = { kind: 'maintenance-pilot', baseline: short(baseline), refactor: short(refactor), requirementsV2: short(v2), equivalence: processStatus(proof, { verification: true }), changedRequirements: changes, notes: ['V2 is an explicit simulated input-limit change, not backward compatible policy.', 'Human review/repair cost and real dependency upgrades are not measured by this automated exercise.'] };
  report.status = [baseline, refactor, v2].every(r => r.report.status === 'accepted-for-pilot') && report.equivalence === 'passed' && changes.every(c => c.changed) ? 'passed' : 'failed';
  const reportFile = path.join(directory, 'evolution.json'); await writeJson(reportFile, report);
  return { report, reportFile, refactor, v2 };
}

export async function runAttacks({ baseline, progress = () => {} } = {}) {
  baseline ??= await runPipeline({ progress });
  if (baseline.report.status !== 'accepted-for-pilot') throw new Error(`Attacks require an accepted baseline: ${baseline.reportFile}`);
  const directory = await runDirectory('attacks');
  const catalog = checkCatalog(await readJson(path.join(ROOT, 'trusted', 'catalog.json')));
  const original = await readJson(candidate('baseline')); const outcomes = [];
  function mustReject(name, operation) {
    let error = null; try { operation(); } catch (failure) { error = failure.message; }
    outcomes.push({ name, status: error ? 'passed' : 'failed', observed: error ?? 'unexpectedly accepted' }); progress(`${name}: ${error ? 'rejected as expected' : 'FAILED'}`);
  }
  const mutatedSpec = changes => { const value = structuredClone(catalog); Object.assign(value.components[0], changes); return value; };
  mustReject('impossible-precondition', () => validateSpecifications(mutatedSpec({ precondition: 'price > 0 && price < 0' }), evaluate, 'v1'));
  mustReject('overrestricted-precondition', () => validateSpecifications(mutatedSpec({ precondition: 'price == 101' }), evaluate, 'v1'));
  mustReject('vacuous-domain', () => validateSpecifications(mutatedSpec({ domain: 'false' }), evaluate, 'v1'));
  mustReject('tautological-postcondition', () => validateSpecifications(mutatedSpec({ postcondition: 'true' }), evaluate, 'v1'));
  mustReject('wrong-definition', () => validateSpecifications(mutatedSpec({ postcondition: 'r == 0' }), evaluate, 'v1'));
  mustReject('contract-edit-in-submission', () => checkCandidate({ ...original, precondition: 'false' }, catalog));
  mustReject('missing-component', () => { const copy = structuredClone(original); delete copy.implementations.discount; checkCandidate(copy, catalog); });
  for (const [name, expression] of [['assumption-injection', '0; assume false;'], ['skipped-verification', '{:verify false} 0'], ['foreign-code', 'process.exit(0)']]) {
    mustReject(name, () => checkCandidate({ ...original, implementations: { ...original.implementations, discount: expression } }, catalog));
  }

  const tools = await toolchain();
  const vacuityFile = path.join(directory, 'Vacuous.dfy');
  await writeFile(vacuityFile, 'function Wrong(x: int): (r: int)\n  requires x > 0 && x < 0\n  ensures r == x + 1\n{ 999 }\n');
  const vacuity = await verifyDafny(vacuityFile, tools);
  await writeFile(path.join(directory, 'vacuity.log'), vacuity.stdout + vacuity.stderr);
  outcomes.push({ name: 'demonstrate-vacuous-proof', status: processStatus(vacuity, { verification: true }) === 'passed' ? 'passed' : 'failed', observed: 'A contradictory precondition can verify a wrong implementation; independent specification checks must reject it.' });

  // This restriction evades the finite example set; the universal domain obligation must catch it.
  const rarePre = mutatedSpec({ precondition: 'price != 314159265358979' });
  const coverageFile = path.join(directory, 'RestrictedCoverage.dfy');
  await writeFile(coverageFile, specificationSource(rarePre));
  const coverage = await verifyDafny(coverageFile, tools);
  await writeFile(path.join(directory, 'coverage.log'), coverage.stdout + coverage.stderr);
  outcomes.push({ name: 'universal-domain-coverage', status: processStatus(coverage, { verification: true }) === 'rejected' ? 'passed' : 'failed', observed: processStatus(coverage, { verification: true }) });

  const auditFile = path.join(directory, 'Assumed.dfy');
  await writeFile(auditFile, 'method Unsound() { assume {:axiom} false; }\n');
  const audit = await runProcess(tools.dafny, ['audit', auditFile]);
  await writeFile(path.join(directory, 'audit.log'), audit.stdout + audit.stderr);
  outcomes.push({ name: 'audit-zero-exit-with-findings', status: audit.code === 0 && classifyAudit(audit) === 'rejected' ? 'passed' : 'failed', observed: { exitCode: audit.code, classification: classifyAudit(audit) } });

  const timeout = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 150 });
  outcomes.push({ name: 'timeout-is-unknown', status: processStatus(timeout) === 'unknown' ? 'passed' : 'failed', observed: processStatus(timeout) });

  const rare = structuredClone(original); rare.label = 'rare-branch-bugs';
  for (const c of catalog.components) rare.implementations[c.id] = `if ${c.parameters[0]} == 314159265358979 then 99999999 else (${rare.implementations[c.id]})`;
  const rareFile = path.join(directory, 'rare-branch-bugs.json'); await writeJson(rareFile, rare);
  const testsOnly = await runPipeline({ candidateFile: rareFile, mode: 'tests', progress });
  const formal = await runPipeline({ candidateFile: rareFile, mode: 'formal', progress });
  const full = await runPipeline({ candidateFile: rareFile, mode: 'full', progress });
  outcomes.push({ name: 'rare-bugs-evade-finite-tests', status: testsOnly.report.status === 'experiment-passed' ? 'passed' : 'failed', observed: short(testsOnly) });
  outcomes.push({ name: 'formal-gate-rejects-rare-bugs', status: formal.report.checks.some(c => c.name === 'implementation-proof' && c.status === 'rejected') ? 'passed' : 'failed', observed: short(formal) });
  outcomes.push({ name: 'full-gate-rejects-rare-bugs', status: full.report.checks.some(c => c.name === 'implementation-proof' && c.status === 'rejected') ? 'passed' : 'failed', observed: short(full) });
  const wrong = await runPipeline({ candidateFile: candidate('wrong-discount'), progress });
  outcomes.push({ name: 'incorrect-rounding-implementation', status: wrong.report.checks.some(c => c.name === 'implementation-proof' && c.status === 'rejected') ? 'passed' : 'failed', observed: short(wrong) });

  if (baseline?.report.status === 'accepted-for-pilot') {
    const cloned = path.join(directory, 'tampered-release'); await cp(baseline.directory, cloned, { recursive: true });
    await writeFile(path.join(cloned, 'package', 'index.cjs'), '// replaced after testing\nmodule.exports = {};\n');
    let error = null; try { await inspectReceipt(path.join(cloned, 'report.json')); } catch (e) { error = e.message; }
    outcomes.push({ name: 'stale-package-binding', status: error ? 'passed' : 'failed', observed: error });
  }
  const requiredAttacks = ['impossible-precondition', 'overrestricted-precondition', 'vacuous-domain', 'tautological-postcondition', 'wrong-definition', 'contract-edit-in-submission', 'missing-component', 'assumption-injection', 'skipped-verification', 'foreign-code', 'demonstrate-vacuous-proof', 'universal-domain-coverage', 'audit-zero-exit-with-findings', 'timeout-is-unknown', 'rare-bugs-evade-finite-tests', 'formal-gate-rejects-rare-bugs', 'full-gate-rejects-rare-bugs', 'incorrect-rounding-implementation', 'stale-package-binding'];
  const complete = outcomes.map(o => o.name).sort().join(',') === requiredAttacks.sort().join(',');
  const report = { kind: 'seeded-adversarial-experiment', status: complete && outcomes.every(r => r.status === 'passed') ? 'passed' : 'failed', outcomes, comparison: { tests: short(testsOnly), formal: short(formal), full: short(full) }, limitations: ['Seeded bugs and authored fixtures are not a statistical estimate of production false acceptance.', 'Mutating an active specification is not allowed by candidate ingestion; specification defects are tested in isolated copies.'] };
  const reportFile = path.join(directory, 'attacks.json'); await writeJson(reportFile, report);
  return { report, reportFile };
}

export async function runPilot(progress = () => {}) {
  const output = path.join(ROOT, 'reports', 'pilot-summary.json');
  await writeJson(output, { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString() });
  await writeFile(path.join(ROOT, 'reports', 'PILOT_RESULTS.md'), '# Pilot results\n\nA fresh pilot run is in progress. Previous evidence is retained under artifacts/.\n');
  try { return await executePilot(progress); }
  catch (error) {
    await writeJson(output, { schemaVersion: 1, status: 'failed', completedAt: new Date().toISOString(), error: error.message });
    await writeFile(path.join(ROOT, 'reports', 'PILOT_RESULTS.md'), '# Pilot results\n\nThe latest pilot run failed. Inspect the local pilot-summary.json and artifacts/ logs.\n');
    throw error;
  }
}

async function executePilot(progress) {
  progress('Baseline full acceptance'); const baseline = await runPipeline({ progress });
  if (baseline.report.status !== 'accepted-for-pilot') throw new Error(`Baseline blocked. See ${baseline.reportFile}: ${baseline.report.error}`);
  progress('Maintenance: refactor and explicit requirements revision'); const evolution = await runEvolution({ baseline, progress });
  progress('Adversarial acceptance experiments'); const attacks = await runAttacks({ baseline, progress });
  const inspection = await inspectReceipt(baseline.reportFile);
  const summary = { schemaVersion: 1, status: evolution.report.status === 'passed' && attacks.report.status === 'passed' ? 'passed' : 'failed', completedAt: new Date().toISOString(), baseline: short(baseline), evolution: { status: evolution.report.status, reportFile: path.relative(ROOT, evolution.reportFile).split(path.sep).join('/') }, attacks: { status: attacks.report.status, count: attacks.report.outcomes.length, reportFile: path.relative(ROOT, attacks.reportFile).split(path.sep).join('/') }, inspection, measurements: { modelCalls: null, humanReviewMinutes: null, note: 'These require a subsequent independently reviewed model-comparison study.' } };
  const reportFile = path.join(ROOT, 'reports', 'pilot-summary.json'); await writeJson(reportFile, summary);
  const lines = ['# Pilot results', '', `Completed: ${summary.completedAt}`, '', `Overall: **${summary.status}**`, '', '| Run | Status | Evidence |', '|---|---|---|', `| Baseline, 20 components | ${baseline.report.status} | [receipt](../${summary.baseline.reportFile}) |`, `| Refactor and v2 requirements | ${evolution.report.status} | [evolution](../${summary.evolution.reportFile}) |`, `| ${summary.attacks.count} adversarial checks | ${attacks.report.status} | [attacks](../${summary.attacks.reportFile}) |`, '', 'These results establish behavior on the authored pilot tasks under the recorded trust assumptions. They are not a production certification or a model success-rate estimate.', '', '## Per-component compiled checks', '', '| Component | Examples and generated cases | Encoding/error checks |', '|---|---:|---:|', ...baseline.report.components.map(c => `| ${c.id} | ${c.passed} | ${c.encodingChecks} |`), '', '## Adversarial checks', '', ...attacks.report.outcomes.map(o => `- ${o.name}: ${o.status}`), ''];
  await writeFile(path.join(ROOT, 'reports', 'PILOT_RESULTS.md'), lines.join('\n'));
  return { summary, reportFile, baseline };
}
