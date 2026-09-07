import { createRequire } from 'node:module';
import { readJson, writeJson } from './common.mjs';
import { generatedInputs } from './contracts.mjs';
import { evaluate } from '../trusted/oracles.mjs';

const [catalogFile, packageFile, resultFile, policyVersion] = process.argv.slice(2);
try {
  const catalog = await readJson(catalogFile);
  const api = createRequire(import.meta.url)(packageFile);
  const components = []; const failures = [];
  for (const c of catalog.components) {
    let passed = 0; let errorPaths = 0; const start = performance.now();
    for (const sample of generatedInputs(c)) {
      const expected = evaluate(c.id, sample.args.map(BigInt), policyVersion).toString();
      const actual = api[c.id](...sample.args);
      if (actual !== expected) failures.push({ id: c.id, args: sample.args, expected, actual, label: sample.label });
      else passed++;
      if (expected === '-1') errorPaths++;
    }
    let encodingChecks = 0;
    for (const invalid of [1, 1n, null, undefined, '01', '-0', '1.0', '1e3', '', '9'.repeat(201)]) {
      const args = [...c.witness]; args[0] = invalid;
      let rejected = false;
      try { api[c.id](...args); } catch (error) { rejected = error instanceof TypeError; }
      if (!rejected) failures.push({ id: c.id, label: 'invalid-encoding', value: String(invalid) });
      else encodingChecks++;
    }
    for (const args of [[], [...c.witness, '1']]) {
      let rejected = false;
      try { api[c.id](...args); } catch (error) { rejected = error instanceof TypeError; }
      if (!rejected) failures.push({ id: c.id, label: 'invalid-arity' }); else encodingChecks++;
    }
    components.push({ id: c.id, passed, errorPaths, encodingChecks, durationMs: Math.round((performance.now() - start) * 100) / 100 });
  }
  await writeJson(resultFile, { status: failures.length ? 'rejected' : 'passed', components, failures: failures.slice(0, 50), failureCount: failures.length });
  if (failures.length) process.exitCode = 1;
} catch (error) { await writeJson(resultFile, { status: 'unknown', error: error.message }); process.exitCode = 2; }
