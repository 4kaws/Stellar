import { lstat, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, readJson, sha256, runProcess } from './common.mjs';

const require = createRequire(import.meta.url);
const isDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function workspacePath(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid pinned toolchain path');
  const absolute = path.resolve(ROOT, relative);
  if (!isInside(ROOT, absolute) || absolute === ROOT) throw new Error(`Toolchain path escapes workspace: ${relative}`);
  // lstat each ancestor too: checking only the final file misses directory junctions.
  let current = ROOT;
  for (const segment of path.relative(ROOT, absolute).split(path.sep)) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink or junction in pinned toolchain: ${current}`);
  }
  return absolute;
}

async function verifyTree(integrity, label) {
  if (!integrity || !Number.isSafeInteger(integrity.fileCount) || integrity.fileCount < 1 || !isDigest(integrity.treeSha256)) {
    throw new Error(`Missing or invalid ${label} integrity pin`);
  }
  const root = await workspacePath(integrity.root);
  if (!(await lstat(root)).isDirectory()) throw new Error(`${label} integrity root is not a directory`);
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Symlink or junction in ${label}: ${absolute}`);
      if (info.isDirectory()) await collect(absolute);
      else if (info.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        if (/[\t\r\n]/.test(relative)) throw new Error(`Unsupported filename in ${label} integrity manifest`);
        files.push(relative);
        if (files.length > integrity.fileCount) throw new Error(`${label} integrity file count mismatch`);
      } else throw new Error(`Non-regular file in ${label}: ${absolute}`);
    }
  }
  await collect(root);
  if (files.length !== integrity.fileCount) throw new Error(`${label} integrity file count mismatch: expected ${integrity.fileCount}, got ${files.length}`);
  // JavaScript's default UTF-16 sort matches .NET StringComparer.Ordinal used by bootstrap.
  files.sort();
  const manifest = [];
  for (const relative of files) manifest.push(`${relative}\t${sha256(await readFile(path.join(root, relative)))}\n`);
  if (sha256(manifest.join('')) !== integrity.treeSha256) throw new Error(`${label} integrity tree mismatch`);
  return root;
}

async function verifyExecutable(pin, root, label) {
  if (!pin || !isDigest(pin.sha256)) throw new Error(`Missing or invalid ${label} executable pin`);
  const absolute = await workspacePath(pin.path);
  if (!isInside(root, absolute) || !(await lstat(absolute)).isFile()) throw new Error(`${label} executable is outside the pinned distribution`);
  if (sha256(await readFile(absolute)) !== pin.sha256) throw new Error(`Pinned ${label} executable changed`);
  return absolute;
}

async function verifyRuntime(configuration) {
  const runtime = configuration.runtime?.bignumber;
  if (!runtime || typeof runtime.version !== 'string' || typeof runtime.integrity !== 'string') throw new Error('Missing BigNumber runtime pin');
  const root = await verifyTree(runtime.integrityTree, 'BigNumber runtime');
  const expectedRoot = path.join(ROOT, 'node_modules', 'bignumber.js');
  if (root !== expectedRoot) throw new Error('BigNumber runtime pin must cover the installed workspace dependency');
  const installed = await readJson(path.join(root, 'package.json'));
  const packageManifest = await readJson(path.join(ROOT, 'package.json'));
  const packageLock = await readJson(path.join(ROOT, 'package-lock.json'));
  const locked = packageLock.packages?.['node_modules/bignumber.js'];
  if (installed.name !== 'bignumber.js' || installed.version !== runtime.version ||
      packageManifest.dependencies?.['bignumber.js'] !== runtime.version ||
      packageLock.packages?.['']?.dependencies?.['bignumber.js'] !== runtime.version ||
      locked?.version !== runtime.version || locked?.integrity !== runtime.integrity) {
    throw new Error('BigNumber installed version, package manifest, or npm lock disagrees with the toolchain pin');
  }
  if (require.resolve('bignumber.js') !== path.join(root, 'bignumber.js')) throw new Error('BigNumber resolves outside the pinned CommonJS runtime');
}

export async function toolchain() {
  const configuration = await readJson(path.join(ROOT, 'toolchain.json'));
  if (configuration.schemaVersion !== 1 || configuration.dafny?.platform !== 'win-x64' || process.platform !== 'win32') {
    throw new Error('The pinned pilot toolchain requires Windows x64 and toolchain schema version 1');
  }
  const root = await verifyTree(configuration.dafny.integrity, 'Dafny distribution');
  const dafny = await verifyExecutable(configuration.dafny.executable, root, 'Dafny');
  const solver = await verifyExecutable(configuration.dafny.solver, root, 'Z3');
  await verifyRuntime(configuration);
  // Execute nothing from the downloaded distribution until every integrity check passes.
  const result = await runProcess(dafny, ['--version'], { timeoutMs: 15000 });
  if (result.code !== 0 || result.timedOut || result.overflow || result.error || result.stdout.trim() !== configuration.dafny.versionOutput) {
    throw new Error('The exact pinned Dafny version could not be confirmed');
  }
  return { dafny, solver, configuration, version: result.stdout.trim() };
}
