import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { ROOT, readJson, runProcess } from './common.mjs';
import { lockPath, sealPilot, checkTrust, inspectReceipt } from './trust.mjs';
import { runPipeline, toolchain } from './pipeline.mjs';
import { runPilot, runAttacks, runEvolution } from './experiments.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const progress = message => console.log(message);
function options() {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--candidate', '--policy', '--mode', '--timeout-ms'].includes(args[i]) || args[i + 1] === undefined) throw new Error(`Unknown or incomplete option ${args[i]}`);
    result[args[i].slice(2)] = args[++i];
  }
  if (result['timeout-ms'] !== undefined && (!/^[0-9]+$/.test(result['timeout-ms']) || Number(result['timeout-ms']) < 100 || Number(result['timeout-ms']) > 300000)) throw new Error('Timeout must be 100–300000 ms');
  return { candidateFile: result.candidate ? path.resolve(result.candidate) : undefined, policyVersion: result.policy ?? 'v1', mode: result.mode ?? 'full', timeoutMs: result['timeout-ms'] ? Number(result['timeout-ms']) : undefined, progress };
}
try {
  switch (command) {
    case 'setup': {
      const setup = await runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'setup-tools.ps1')], { timeoutMs: 300000 });
      process.stdout.write(setup.stdout); process.stderr.write(setup.stderr);
      if (setup.code !== 0 || setup.error || setup.timedOut) throw new Error('Toolchain setup failed; see output above');
      await toolchain();
      let exists = true; try { await access(lockPath); } catch { exists = false; }
      if (!exists) console.log('Initial authored pilot baseline:', await sealPilot());
      else await checkTrust();
      console.log('Ready. Run npm test and npm run pilot.'); break;
    }
    case 'seal': {
      if (args.length !== 1 || args[0] !== '--accept-pilot-defaults') throw new Error('After reviewing local trusted changes, use: node src/cli.mjs seal --accept-pilot-defaults');
      await toolchain(); console.log(await sealPilot()); break;
    }
    case 'doctor': console.log(JSON.stringify({ node: process.version, dafny: (await toolchain()).version, trust: await checkTrust() }, null, 2)); break;
    case 'check': {
      const run = await runPipeline(options()); console.log(`${run.report.status}\n${run.reportFile}`);
      if (!['accepted-for-pilot', 'experiment-passed'].includes(run.report.status)) { console.error(run.report.error); process.exitCode = 1; } break;
    }
    case 'pilot': {
      if (args.length) throw new Error('pilot takes no options; use check for individual submissions');
      const run = await runPilot(progress); console.log(`${run.summary.status}\n${run.reportFile}`); if (run.summary.status !== 'passed') process.exitCode = 1; break;
    }
    case 'attacks': {
      if (args.length) throw new Error('attacks takes no options');
      const baseline = await runPipeline({ progress }); const run = await runAttacks({ baseline, progress });
      console.log(`${run.report.status}\n${run.reportFile}`); if (run.report.status !== 'passed') process.exitCode = 1; break;
    }
    case 'evolve': {
      if (args.length) throw new Error('evolve takes no options');
      const run = await runEvolution({ progress }); console.log(`${run.report.status}\n${run.reportFile}`); if (run.report.status !== 'passed') process.exitCode = 1; break;
    }
    case 'inspect': {
      if (args.length !== 1) throw new Error('Usage: node src/cli.mjs inspect artifacts/<run>/report.json');
      console.log(await inspectReceipt(path.resolve(args[0]))); break;
    }
    case 'prompt': {
      const version = args[0] ?? 'v1'; if (!['v1', 'v2'].includes(version) || args.length > 1) throw new Error('Usage: node src/cli.mjs prompt [v1|v2]');
      await checkTrust(); const catalog = await readJson(path.join(ROOT, 'trusted', version === 'v1' ? 'catalog.json' : 'catalog-v2.json'));
      console.log('Return JSON only: {"schemaVersion":1,"label":"your-label","implementations":{"id":"Dafny expression",...}}. Supply all20 IDs. Integer parameters and results are mathematical integers. Use only integer literals, parameter identifiers, arithmetic + - * / %, comparisons, && || !, parentheses, and if/then/else. No calls, declarations, assumptions, imports, contract edits or Markdown. -1 is the numeric invalid-argument result. Use the listed policy and preserve each contract. Proof search is performed by the pinned Dafny verifier.');
      console.log(JSON.stringify(catalog.components.map(({ id, parameters, requirement, precondition, postcondition }) => ({ id, parameters, requirement, precondition, postcondition })), null, 2)); break;
    }
    case 'help': console.log(`Verified code pilot (Windows x64, Node22+)\n\n  npm ci --ignore-scripts\n  npm run setup\n  npm test\n  npm run pilot\n\n  node src/cli.mjs prompt [v1|v2]\n  node src/cli.mjs check --candidate candidates/baseline.json --policy v1\n  node src/cli.mjs inspect artifacts/<run>/report.json\n  node src/cli.mjs attacks\n  node src/cli.mjs evolve\n\nOnly full checks produce accepted-for-pilot status. --mode tests|formal is experimental.\nTrusted changes require explicit review and seal --accept-pilot-defaults.`); break;
    default: throw new Error(`Unknown command ${command}; use help`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
