import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
export async function writeJson(file, data) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data, null, 2) + '\n'); }
export async function runDirectory(label = 'run') {
  const directory = path.join(ROOT, 'artifacts', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true }); return directory;
}

export function runProcess(command, args, { cwd = ROOT, timeoutMs = 60000, maxOutput = 2000000, env = process.env } = {}) {
  return new Promise(resolve => {
    const started = performance.now(); let stdout = ''; let stderr = ''; let timedOut = false; let overflow = false; let settled = false;
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const fallback = setTimeout(() => child.kill('SIGKILL'), 250);
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { clearTimeout(fallback); child.kill('SIGKILL'); });
        killer.on('close', () => { clearTimeout(fallback); child.kill('SIGKILL'); });
      }
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const finish = (code, error = null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, overflow, error, durationMs: Math.round(performance.now() - started) });
    };
    const collect = target => chunk => {
      if (stdout.length + stderr.length + chunk.length > maxOutput) { overflow = true; stop(); return; }
      if (target === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.on('error', error => finish(null, error.message)); child.on('close', code => finish(code));
  });
}

export function processStatus(result, { verification = false } = {}) {
  if (result.timedOut || result.overflow || result.error || result.code === null) return 'unknown';
  if (/timed? ?out|time outs?|inconclusive|out of resource/i.test(result.stdout + result.stderr)) return 'unknown';
  if (result.code !== 0) return 'rejected';
  if (verification) {
    const summaries = [...(result.stdout + result.stderr).matchAll(/Dafny program verifier finished with (\d+) verified, (\d+) errors?[^\r\n]*/g)];
    if (summaries.length !== 1 || Number(summaries[0][1]) === 0 || Number(summaries[0][2]) !== 0 || /Warning:|Error:/i.test(result.stdout + result.stderr)) return 'unknown';
  }
  return 'passed';
}
