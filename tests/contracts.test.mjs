import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkCatalog,
  checkCandidate,
  generatedInputs,
  validateSpecifications,
  specificationSource,
} from '../src/contracts.mjs';
import { evaluateExpression, parseExpression } from '../src/expression.mjs';
import { evaluate } from '../trusted/oracles.mjs';

const read = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const v1 = read('../trusted/catalog.json');
const v2 = read('../trusted/catalog-v2.json');
const baseline = read('../candidates/baseline.json');
const revised = read('../candidates/requirements-v2.json');
const mutatedCatalog = (change) => {
  const catalog = structuredClone(v1);
  change(catalog.components[0], catalog);
  return catalog;
};
const environment = (component, args) => Object.fromEntries(component.parameters.map((name, index) => [name, BigInt(args[index])]));

for (const [version, catalog, candidate] of [['v1', v1, baseline], ['v2', v2, revised]]) {
  test(`${version} catalog admits explicit and generated intended inputs and rejects wrong outputs`, () => {
    assert.equal(checkCatalog(catalog), catalog);
    const evidence = validateSpecifications(catalog, evaluate, version);
    assert.equal(evidence.length, 20);
    for (const component of evidence) {
      assert.ok(component.positives >= 166);
      assert.equal(component.negatives, component.positives * 2);
      assert.equal(component.discarded, 0);
    }
  });

  test(`${version} candidate conforms to the catalog and independently specified examples`, () => {
    const implementations = checkCandidate(candidate, catalog);
    assert.equal(Object.keys(implementations).length, 20);
    for (const component of catalog.components) {
      for (const example of component.cases) {
        assert.equal(
          evaluateExpression(implementations[component.id], environment(component, example.args)),
          BigInt(example.expected),
          `${version}: ${component.id}/${example.label}`,
        );
      }
    }
  });
}

test('the v2 requirements revision changes an observed valid input for every component', () => {
  const stale = checkCandidate(baseline, v2);
  for (const component of v2.components) {
    const changed = component.cases.filter((example) =>
      evaluate(component.id, example.args.map(BigInt), 'v1') !== BigInt(example.expected));
    assert.ok(changed.length > 0, `${component.id} needs a changed requirement example`);
    assert.ok(changed.some((example) =>
      evaluateExpression(stale[component.id], environment(component, example.args)) !== BigInt(example.expected)),
    `${component.id}: stale implementation must be detected`);
  }
});

test('an impossible precondition is rejected instead of skipping all examples', () => {
  const catalog = mutatedCatalog((component) => { component.precondition = 'price > 0 && price < 0'; });
  assert.doesNotThrow(() => checkCatalog(catalog));
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /non-vacuity witness excluded/);
});

test('a satisfiable precondition is still rejected when it excludes an intended input', () => {
  const catalog = mutatedCatalog((component) => { component.precondition = 'price > 0'; });
  const component = catalog.components[0];
  const precondition = parseExpression(component.precondition, component.parameters, 'bool');
  assert.equal(evaluateExpression(precondition, environment(component, component.witness)), true);
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /intended input excluded by precondition/);
});

test('specification generation does not filter out invalid numerical inputs', () => {
  const original = v1.components[0];
  const restricted = { ...original, precondition: 'price > 0' };
  assert.deepEqual(generatedInputs(restricted), generatedInputs(original));
  assert.ok(generatedInputs(restricted).some((sample) => sample.args[0] === '-1'));
});

test('a tautological postcondition is rejected because it admits forbidden results', () => {
  const catalog = mutatedCatalog((component) => { component.postcondition = 'true'; });
  assert.doesNotThrow(() => checkCatalog(catalog));
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /specification permits forbidden output/);
});

test('a plausible but underconstrained postcondition is rejected', () => {
  const catalog = mutatedCatalog((component) => { component.postcondition = 'r >= -1'; });
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /specification permits forbidden output/);
});

test('an incorrect postcondition is rejected because it excludes expected results', () => {
  const catalog = mutatedCatalog((component) => { component.postcondition = 'r == -1'; });
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /specification rejects expected result/);
});

test('an impossible domain cannot make the coverage obligation vacuous unnoticed', () => {
  const catalog = mutatedCatalog((component) => { component.domain = 'false'; });
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /non-vacuity witness excluded/);
});

test('an otherwise satisfiable domain cannot silently exclude intended inputs', () => {
  const catalog = mutatedCatalog((component) => { component.domain = 'price > 0'; });
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /intended input excluded by domain/);
});

test('explicit expected values are checked against the independent oracle', () => {
  const catalog = mutatedCatalog((component) => { component.cases[0].expected = '76'; });
  assert.throws(() => validateSpecifications(catalog, evaluate, 'v1'), /independent oracle disagrees with explicit example/);
});

test('a syntactically valid return-zero mutant violates the unchanged trusted contract', () => {
  const mutant = structuredClone(baseline);
  mutant.implementations.discount = '0';
  const parsed = checkCandidate(mutant, v1);
  const component = v1.components[0];
  const example = component.cases[0];
  const env = environment(component, example.args);
  const result = evaluateExpression(parsed.discount, env);
  const post = parseExpression(component.postcondition, [...component.parameters, 'r'], 'bool');
  assert.notEqual(result, BigInt(example.expected));
  assert.equal(evaluateExpression(post, { ...env, r: result }), false);
  const mutantOracle = (id, args, version) => id === 'discount' ? 0n : evaluate(id, args, version);
  assert.throws(() => validateSpecifications(v1, mutantOracle, 'v1'), /independent oracle disagrees/);
});

test('candidate schema rejects added or removed implementations', () => {
  const added = structuredClone(baseline);
  added.implementations.unreviewed_rule = '0';
  assert.throws(() => checkCandidate(added, v1), /exactly the trusted component IDs/);
  const removed = structuredClone(baseline);
  delete removed.implementations.discount;
  assert.throws(() => checkCandidate(removed, v1), /exactly the trusted component IDs/);
});

test('a candidate cannot replace its contract or add verification options', () => {
  for (const extra of [
    { precondition: 'false' },
    { postcondition: 'true' },
    { options: ['--no-verify'] },
    { schemaVersion: 2 },
  ]) {
    assert.throws(() => checkCandidate({ ...baseline, ...extra }, v1), /Candidate must contain only/);
  }
});

test('candidate expressions cannot inject assumptions, attributes, imports, or executable code', () => {
  const injections = [
    'assume false; 0',
    '0 } lemma Attack() { assume false; }',
    '{:axiom} 0',
    '0; process.exit(0)',
    "require('node:fs').readFileSync('secret')",
    'import opened Other; 0',
    'eval(price)',
    'price /* ignored? */',
    'true',
  ];
  for (const injection of injections) {
    const candidate = structuredClone(baseline);
    candidate.implementations.discount = injection;
    assert.throws(() => checkCandidate(candidate, v1), undefined, injection);
  }
});

test('malformed trusted expressions are rejected before source generation', () => {
  const catalog = mutatedCatalog((component) => { component.postcondition = 'true; assume false;'; });
  assert.throws(() => checkCatalog(catalog), /Unsupported token/);
  assert.throws(() => specificationSource(catalog), /Unsupported token/);
});

test('catalog validation requires exact integer examples, valid identities, and provenance', () => {
  const changes = [
    (component) => { component.cases[0].expected = 75; },
    (component) => { component.cases[0].args[0] = '1e2'; },
    (component) => { component.cases[0].args.pop(); },
    (component) => { component.parameters[0] = 'r'; },
    (component) => { component.source = ''; },
    (component, catalog) => { catalog.components[1].id = component.id; },
    (component) => { component.cases = component.cases.slice(0, 5); },
  ];
  for (const change of changes) assert.throws(() => checkCatalog(mutatedCatalog(change)));
});

test('formal specification source contains coverage, reachability, and positive and negative obligations', () => {
  const source = specificationSource(v1);
  for (const component of v1.components) {
    assert.ok(source.includes(`lemma Coverage_${component.name}(`));
    assert.ok(source.includes(`requires Domain_${component.name}(`));
    assert.ok(source.includes(`ensures Pre_${component.name}(`));
    assert.match(source, new RegExp(`lemma (?:\\{:[^}]+\\} )?Examples_${component.name}\\(\\)`));
    assert.ok(source.includes(`assert Domain_${component.name}(`));
    assert.ok(source.includes(`assert Pre_${component.name}(`));
    assert.ok(source.includes(`assert Post_${component.name}(`));
    assert.ok(source.includes(`assert !Post_${component.name}(`));
  }
  assert.ok(source.includes('assert Pre_Discount((-1), 100);'));
  assert.ok(source.includes('assert Post_Discount(100, 2500, 75);'));
  assert.ok(source.includes('assert !Post_Discount(100, 2500, 74);'));
  assert.ok(source.includes('assert !Post_Discount(100, 2500, 76);'));
  assert.doesNotMatch(source, /\bassume\b|\baxiom\b|\bextern\b/);
});
