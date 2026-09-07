import { parseExpression, emitExpression, evaluateExpression } from './expression.mjs';

const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
export const decimal = /^(0|-?[1-9][0-9]*)$/;
export function decimalValue(value) {
  if (typeof value !== 'string' || value.length > 200 || !decimal.test(value)) throw new Error('Expected a canonical decimal integer string of at most 200 characters');
  return BigInt(value);
}
export function checkCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.components) || catalog.components.length !== 20) throw new Error('Catalog must contain exactly 20 pilot components');
  const ids = new Set(); const names = new Set();
  for (const component of catalog.components) {
    const { id, name, parameters, cases, witness, samples } = component;
    if (!identifier.test(id) || !identifier.test(name) || ids.has(id) || names.has(name)) throw new Error('Invalid or duplicate component identity');
    ids.add(id); names.add(name);
    if (!Array.isArray(parameters) || parameters.length < 1 || parameters.length > 5 || new Set(parameters).size !== parameters.length || parameters.some(p => !identifier.test(p) || ['r', 'true', 'false', 'if', 'then', 'else'].includes(p))) throw new Error(`Invalid parameters: ${id}`);
    if (!component.requirement || !component.source) throw new Error(`Missing requirement provenance: ${id}`);
    parseExpression(component.domain, parameters, 'bool');
    parseExpression(component.precondition, parameters, 'bool');
    parseExpression(component.postcondition, [...parameters, 'r'], 'bool');
    const checkArgs = args => { if (!Array.isArray(args) || args.length !== parameters.length) throw new Error(`Wrong arity: ${id}`); args.forEach(decimalValue); };
    checkArgs(witness);
    if (!Array.isArray(cases) || cases.length < 6) throw new Error(`Insufficient independent examples: ${id}`);
    for (const test of cases) { checkArgs(test.args); decimalValue(test.expected); }
    if (!Array.isArray(samples) || samples.length !== parameters.length || samples.some(s => !Array.isArray(s) || s.length === 0)) throw new Error(`Invalid samples: ${id}`);
    samples.flat().forEach(decimalValue);
  }
  return catalog;
}

export function checkCandidate(candidate, catalog) {
  if (!candidate || Object.keys(candidate).sort().join(',') !== 'implementations,label,schemaVersion' || candidate.schemaVersion !== 1 || typeof candidate.label !== 'string' || candidate.label.length > 100) throw new Error('Candidate must contain only schemaVersion, label, and implementations');
  if (!candidate.implementations || typeof candidate.implementations !== 'object' || Array.isArray(candidate.implementations)) throw new Error('Missing implementations');
  const expected = catalog.components.map(c => c.id).sort().join(',');
  if (Object.keys(candidate.implementations).sort().join(',') !== expected) throw new Error('Candidate must supply exactly the trusted component IDs');
  const parsed = {};
  for (const component of catalog.components) parsed[component.id] = parseExpression(candidate.implementations[component.id], component.parameters, 'int');
  return parsed;
}

export function generatedInputs(component, count = 160) {
  // Stable generation from a reviewed independent domain; never filter through P.
  let state = 0x61c88647;
  for (const ch of component.id) state = (Math.imul(state, 31) + ch.charCodeAt(0)) >>> 0;
  const next = n => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % n; };
  const cases = component.cases.map(t => ({ args: t.args, expected: t.expected, source: 'example', label: t.label }));
  for (let i = 0; i < count; i++) {
    const args = component.samples.map(values => values[next(values.length)]);
    cases.push({ args, source: 'generated', label: `seeded-${i}` });
  }
  return cases;
}

export function validateSpecifications(catalog, oracle, policyVersion) {
  const results = [];
  for (const component of catalog.components) {
    const pre = parseExpression(component.precondition, component.parameters, 'bool');
    const domain = parseExpression(component.domain, component.parameters, 'bool');
    const post = parseExpression(component.postcondition, [...component.parameters, 'r'], 'bool');
    const environment = args => Object.fromEntries(component.parameters.map((p, i) => [p, decimalValue(args[i])]));
    const witnessEnv = environment(component.witness);
    if (!evaluateExpression(domain, witnessEnv) || !evaluateExpression(pre, witnessEnv)) throw new Error(`${component.id}: non-vacuity witness excluded`);
    let positives = 0; let negatives = 0;
    for (const test of generatedInputs(component)) {
      const args = test.args.map(decimalValue); const env = environment(test.args);
      const expected = oracle(component.id, args, policyVersion);
      if (test.expected !== undefined && expected !== decimalValue(test.expected)) throw new Error(`${component.id}: independent oracle disagrees with explicit example ${test.label}`);
      if (!evaluateExpression(domain, env)) throw new Error(`${component.id}: intended input excluded by domain`);
      if (!evaluateExpression(pre, env)) throw new Error(`${component.id}: intended input excluded by precondition`);
      if (!evaluateExpression(post, { ...env, r: expected })) throw new Error(`${component.id}: specification rejects expected result at ${test.label}`);
      positives++;
      for (const wrong of [expected - 1n, expected + 1n]) {
        if (evaluateExpression(post, { ...env, r: wrong })) throw new Error(`${component.id}: specification permits forbidden output at ${test.label}`);
        negatives++;
      }
    }
    results.push({ id: component.id, positives, negatives, discarded: 0, witness: component.witness });
  }
  return results;
}

const emitted = (source, parameters, type) => emitExpression(parseExpression(source, parameters, type));
const literal = value => BigInt(value) < 0n ? `(${value})` : value;
export function specificationSource(catalog) {
  const blocks = ['// Generated exclusively from the trusted specification package.', 'module SpecificationChecks {'];
  for (const c of catalog.components) {
    const parameters = c.parameters.map(p => `${p}: int`).join(', ');
    const args = c.parameters.join(', ');
    blocks.push(`  predicate Domain_${c.name}(${parameters}) { ${emitted(c.domain, c.parameters, 'bool')} }`);
    blocks.push(`  predicate Pre_${c.name}(${parameters}) { ${emitted(c.precondition, c.parameters, 'bool')} }`);
    blocks.push(`  predicate Post_${c.name}(${parameters}, r: int) { ${emitted(c.postcondition, [...c.parameters, 'r'], 'bool')} }`);
    blocks.push(`  lemma Coverage_${c.name}(${parameters})\n    requires Domain_${c.name}(${args})\n    ensures Pre_${c.name}(${args})\n  { }`);
    // Isolate concrete checks so facts about unrelated divisors do not accumulate
    // in one solver query; every original assertion remains a proof obligation.
    blocks.push(`  lemma {:isolate_assertions} Examples_${c.name}()\n  {`);
    const witness = c.witness.map(literal).join(', ');
    blocks.push(`    assert Domain_${c.name}(${witness});\n    assert Pre_${c.name}(${witness});`);
    for (const example of c.cases) {
      const a = example.args.map(literal).join(', '); const r = BigInt(example.expected);
      blocks.push(`    assert Pre_${c.name}(${a});\n    assert Post_${c.name}(${a}, ${literal(String(r))});\n    assert !Post_${c.name}(${a}, ${literal(String(r - 1n))});\n    assert !Post_${c.name}(${a}, ${literal(String(r + 1n))});`);
    }
    blocks.push('  }');
  }
  blocks.push('}'); return blocks.join('\n') + '\n';
}

export function implementationSource(catalog, parsed) {
  const blocks = ['// This file binds checked candidate expressions to fixed trusted contracts.', 'module Pilot {'];
  for (const c of catalog.components) {
    blocks.push(`  function ${c.name}(${c.parameters.map(p => `${p}: int`).join(', ')}): (r: int)\n    requires ${emitted(c.precondition, c.parameters, 'bool')}\n    ensures ${emitted(c.postcondition, [...c.parameters, 'r'], 'bool')}\n  {\n    ${emitExpression(parsed[c.id])}\n  }`);
  }
  blocks.push('}'); return blocks.join('\n\n') + '\n';
}

export function equivalenceSource(catalog, before, after) {
  return 'module Equivalence {\n' + catalog.components.map(c => `  lemma Equal_${c.name}(${c.parameters.map(p => `${p}: int`).join(', ')})\n    ensures ${emitExpression(before[c.id])} == ${emitExpression(after[c.id])}\n  { }`).join('\n') + '\n}\n';
}
