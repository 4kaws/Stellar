# Pinned toolchain

The pilot runs on Windows x64 with Node.js 22 or later and Windows PowerShell 5.1
or later. The official Dafny archive includes its .NET runtime and Z3; no global
Dafny installation is needed. Initial setup requires access to GitHub and npm.

Run from the repository root:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-tools.ps1
node --input-type=module -e "const {toolchain}=await import('./src/toolchain.mjs'); console.log((await toolchain()).version)"
```

The bootstrap downloads the official Dafny **4.11.0** Windows x64 release into
`.tools`, verifies the pinned archive SHA256, extracts to a temporary directory,
checks the complete distribution, and moves it into its final workspace location.
Repeating setup verifies the existing installation. A mismatched installation
fails and is preserved for inspection. The script does not change PATH or install
global packages. Linux and macOS bootstraps are outside this pilot's scope.

`toolchain.json` records the release URL and archive digest, the exact Dafny build,
the selected **Z3 4.12.1** binary, and **bignumber.js 9.3.1**. The Node preflight
checks all **290 Dafny distribution files** and all **10 BigNumber package files**,
including package metadata, before launching Dafny. Missing integrity pins, file
count changes, content changes, symlinks, and directory junctions are rejected.
It also checks the installed BigNumber version against both npm manifests and
the package-lock integrity value.

Tree digests use the same format in PowerShell and Node: sort relative paths by
ordinal UTF-16 order, normalize directory separators to `/`, and hash UTF-8 text
without a BOM containing one `path<TAB>lowercase SHA256<LF>` entry per file.
The toolchain configuration is part of the pilot's reviewed trust baseline.

## Verification and JavaScript integration

For an individual Dafny source file:

```powershell
$dafny = '.tools/dafny-4.11.0/dafny/Dafny.exe'
$solver = '.tools/dafny-4.11.0/dafny/z3/bin/z3-4.12.1.exe'
& $dafny verify Example.dfy --solver-path $solver --cores 2 --verification-time-limit 15 --enforce-determinism
& $dafny audit Example.dfy
& $dafny build Example.dfy --target js --output example.js --solver-path $solver --cores 2 --verification-time-limit 15 --enforce-determinism
```

Each command must be checked separately. A failed build can leave a generated
file behind. In particular, `dafny audit` can exit successfully **with findings**;
the acceptance runner requires an explicit zero-findings summary and no warnings.
Audit does not perform verification itself.

Dafny embeds its JavaScript runtime in the generated file and imports
`bignumber.js`. The package builder appends a fixed CommonJS export footer to the
compiled source; it does not rewrite the algorithm. Module-level members appear
on `Pilot.__default`. Dafny integers use BigNumber values, with decimal strings at
the public boundary to avoid JavaScript number precision loss. Exported Dafny
preconditions do not become automatic JavaScript argument guards, so the wrapper
must enforce its accepted input representation and domain.

The verified property concerns the Dafny implementation under its formal
contract. The trusted computing base includes the reviewed requirements and
acceptance code, Dafny/Boogie/Z3, the compiler and generated runtime, BigNumber,
the JavaScript wrapper, Node.js, and the host operating system and process
environment. Hashes detect differences from the approved toolchain; they do not
prove those tools correct or isolate a malicious host. This pilot does not
produce Lean proof certificates.

## Validation performed

- Fresh installation from the verified cached archive and repeated setup passed.
- Changing a runtime configuration file caused the bootstrap to reject the
  installation in an isolated scratch fixture.
- The Node preflight passed against the actual installed toolchain and runtime.
- Compiled JavaScript passed exact integer arithmetic above `2^53`, method return,
  and sequence interoperability checks.
- An incorrect postcondition failed verification; an axiom-based assumption
  produced an audit finding despite audit's zero exit status.

Primary references: [Dafny 4.11.0 release](https://github.com/dafny-lang/dafny/releases/tag/v4.11.0),
[pinned JavaScript integration documentation](https://github.com/dafny-lang/dafny/blob/v4.11.0/docs/DafnyRef/integration-js/IntegrationJS.md),
[BigNumber 9.3.1 source](https://github.com/MikeMcl/bignumber.js/tree/v9.3.1).
