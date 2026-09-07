# Security policy

Stellar is a beta research framework for evaluating small deterministic libraries
and business rules. Its acceptance status is evidence for the properties of a
particular implementation under a particular specification. It is not a general
production-safety certification. Beta interfaces, policies, and evidence formats
may change; there is no promised security response time or long-term support
window.

## Reporting a vulnerability

If private vulnerability reporting is enabled for this repository, use
[GitHub's private reporting form](https://github.com/4kaws/Stellar/security/advisories/new).
If that form is unavailable, open a minimal issue requesting a private reporting
channel, without exploit details, credentials, or private data. Please include
the affected version or commit, the expected guarantee, and reproducible steps
through the private channel once available.

Reports about specification weakening, vacuous verification, trust-check bypasses,
unintended code execution, incorrect acceptance, and evidence tampering are
particularly useful. Ordinary documentation and usability problems can use
public issues.

## What the beta checks

The pilot accepts a restricted JSON expression format, validates it before
rendering Dafny, checks specifications, runs formal verification and assumption
audits, compiles the same implementation, and tests the generated JavaScript
package. Reviewed inputs, the acceptance implementation, and toolchain/runtime
files have integrity checks. Required failures and unknown verification results
block full acceptance.

These controls have specific limits:

- The supplied business policies are authored examples, not independently
  certified domain requirements. A correct proof of the wrong requirement still
  gives the wrong behavior.
- Restricted input parsing is **not an operating-system sandbox**. Run untrusted
  repositories and modified framework code in an isolated environment with no
  production credentials. Do not grant an external generator write access to the
  reviewed contracts, verifier, runtime, or acceptance policy.
- Receipts are **unsigned local evidence**. Hashes detect changes relative to a
  reviewed baseline; they do not authenticate an unknown publisher or prevent
  someone who controls the baseline from replacing it. Independently rerun checks
  before relying on evidence supplied by another party.
- Dafny, Boogie, Z3, the compiler and generated runtime, BigNumber, the JavaScript
  boundary wrapper, Node.js, and the host environment remain trusted. Proofs cover
  the modeled integer behavior, not every integration, performance, concurrency,
  availability, or side-channel property.
- Finite specification and runtime tests complement proofs. They do not establish
  that every intended real-world requirement has been captured.

Do not automatically reseal a changed trust baseline. Review the changed rules,
code, dependencies, and resulting claims before explicitly accepting a new one.
The CI workflow requires the committed baseline, uses read-only repository
permissions, and does not publish packages or create release attestations.
