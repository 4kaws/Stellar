# Contributing to Stellar

Contributions that make generated code easier to specify, inspect, verify, and maintain are welcome. Useful starting points include clearer examples, counterexamples to accepted claims, specification tests, documentation fixes, and reproducible verifier failures.

This is a public beta for small deterministic libraries and business rules. A passing proof establishes the checked statement under its assumptions. It does not establish that the policy matches a real business requirement.

## Development

See [README.md](README.md) for the supported environment and setup instructions. The initial pilot uses Node.js 24 and the pinned Dafny toolchain on Windows x64.

```powershell
npm ci --ignore-scripts
npm run setup
npm test
npm run pilot
```

Keep changes focused. Include the problem, the intended behavior, and the checks you ran in your pull request. When changing code behavior, include examples at relevant boundaries and a regression case for the original defect. Documentation-only edits do not need a new test suite.

Do not commit downloaded tools, dependencies, generated release packages, access tokens, or private business data. Use small synthetic examples that others can run.

## Requirements and trust changes

Candidate implementation changes should preserve the existing trusted contract. Propose a requirement change explicitly with its source, rationale, admitted inputs, expected outputs, and forbidden outcomes. Update the independent examples and policy documentation with that change. A refactor and a requirement revision should be distinguishable in review.

The trust lock intentionally changes when trusted inputs change. Review those changes before resealing with `node src/cli.mjs seal --accept-pilot-defaults`, then rerun the relevant verification and runtime checks. Resealing records a local baseline; it does not constitute independent approval of a business rule.

Treat missing evidence, solver timeouts, inconclusive results, and failed audits as failures to establish acceptance. Do not relax a contract, add assumptions, or suppress a required check merely to get a passing result. Explain proof repairs and changes to the trusted computing base in the pull request.

## Reporting a problem

Use the repository's issue tracker for ordinary defects and improvement proposals. Include the component, a minimal input or candidate, expected and actual results, tool versions, and the relevant report or log excerpt. Remove secrets and customer data before sharing evidence. Follow [SECURITY.md](SECURITY.md) for a potentially exploitable security issue.

## Contribution license

The project's original contributions are available under either the [MIT License](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at the recipient's option (`MIT OR Apache-2.0`). Both permit commercial use subject to their terms.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in Stellar is submitted under **both** of those licenses, allowing recipients to choose either license. You retain your copyright. Submit only material you have the right to contribute, identify imported material and its license, and preserve third-party notices. Contributions explicitly offered on different terms require maintainers' review before inclusion.

## Supporting the project

Code, careful review, documentation, and useful bug reports all help. A donation service, sponsorship account, or supporting legal organization has not been designated by this project. Licensing does not depend on a donation, and commercial users have the same license choices.
