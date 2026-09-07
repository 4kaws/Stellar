import test from 'node:test';
import assert from 'node:assert/strict';
import { emitExpression, euclideanDiv, evaluateExpression, parseExpression } from '../src/expression.mjs';

const run = (source, environment = {}, expectedType) =>
  evaluateExpression(parseExpression(source, Object.keys(environment), expectedType), environment);

test('arithmetic is exact and follows precedence and left associativity', () => {
  for (const [source, expected] of [
    ['2 + 3 * 4', 14n],
    ['(2 + 3) * 4', 20n],
    ['20 - 5 - 3', 12n],
    ['40 / 5 / 2', 4n],
    ['-2 * -3 + 4', 10n],
    ['-(2 + 3) * 4', -20n],
    ['1000000000000000000000000000001 + 9', 1000000000000000000000000000010n],
  ]) assert.equal(run(source, {}, 'int'), expected, source);
  assert.equal(run('balance - debit * 2', { balance: 25n, debit: 7n }), 11n);
});

test('comparisons, Boolean equality, and Boolean precedence have precise meanings', () => {
  for (const [source, expected] of [
    ['1 + 2 * 3 == 7', true],
    ['1 < 2 && 3 >= 3', true],
    ['true || false && false', true],
    ['(true || false) && false', false],
    ['!false && !(1 > 2)', true],
    ['true == !false', true],
    ['(2 <= 2) != (4 < 3)', true],
    ['3 != 3 || 7 > 8', false],
  ]) assert.equal(run(source, {}, 'bool'), expected, source);
});

test('conditionals select the intended nested branch and preserve result types', () => {
  assert.equal(run('if true then if false then 1 else 2 else 3'), 2n);
  assert.equal(run('if false then 1 else if false then 2 else 3'), 3n);
  assert.equal(run('(if 2 < 3 then 4 else 5) * 6'), 24n);
  assert.equal(run('if true then false else true', {}, 'bool'), false);
  assert.equal(run('if value < 0 then -1 else value + 1', { value: -2n }), -1n);
  assert.equal(run('if value < 0 then -1 else value + 1', { value: 0n }), 1n);
});

test('unselected conditional and Boolean branches are not evaluated', () => {
  assert.equal(run('if true then 7 else 1 / 0'), 7n);
  assert.equal(run('if false then 1 % 0 else 8'), 8n);
  assert.equal(run('false && 1 / 0 == 0'), false);
  assert.equal(run('true || 1 % 0 == 0'), true);
  assert.equal(run('if size == 0 then -1 else amount / size', { amount: 5n, size: 0n }), -1n);
  assert.throws(() => run('if false then 7 else 1 / 0'), /Division by zero/);
  assert.throws(() => run('true && 1 / 0 == 0'), /Division by zero/);
  assert.throws(() => run('false || 1 % 0 == 0'), /Division by zero/);
});

test('Euclidean division handles each sign combination, exact division, and zero', () => {
  for (const [a, b, quotient, remainder] of [
    [7n, 3n, 2n, 1n],
    [-7n, 3n, -3n, 2n],
    [7n, -3n, -2n, 1n],
    [-7n, -3n, 3n, 2n],
    [-6n, 3n, -2n, 0n],
    [-6n, -3n, 2n, 0n],
    [0n, -3n, 0n, 0n],
    [-1n, 5n, -1n, 4n],
    [-1n, -5n, 1n, 4n],
  ]) {
    assert.equal(euclideanDiv(a, b), quotient, `${a} / ${b}`);
    assert.equal(run('a / b', { a, b }), quotient);
    assert.equal(run('a % b', { a, b }), remainder);
  }
  assert.throws(() => euclideanDiv(5n, 0n), /Division by zero/);
  assert.throws(() => run('5 % 0'), /Division by zero/);
});

test('Euclidean quotients and remainders satisfy their defining laws on signed inputs', () => {
  const quotientExpression = parseExpression('a / b', ['a', 'b'], 'int');
  const remainderExpression = parseExpression('a % b', ['a', 'b'], 'int');
  for (let a = -35n; a <= 35n; a++) {
    for (let b = -11n; b <= 11n; b++) {
      if (b === 0n) continue;
      const q = evaluateExpression(quotientExpression, { a, b });
      const r = evaluateExpression(remainderExpression, { a, b });
      assert.equal(b * q + r, a, `decomposition for ${a}, ${b}`);
      assert.ok(r >= 0n && r < (b < 0n ? -b : b), `remainder range for ${a}, ${b}`);
    }
  }
});

test('the grammar rejects executable source, calls, comments, and source directives', () => {
  for (const source of [
    '1; process.exit(0)',
    'process.exit(0)',
    'globalThis["process"]',
    'require("fs")',
    'f(1)',
    'x.y',
    'x[0]',
    '1 // ignore the rest',
    '1 /* hidden */ + 2',
    '1\ninclude "other.dfy"',
    'assert false; 1',
    'assume false',
    '{:axiom} 1',
    'x := 1',
    '"1"',
    '`1`',
    '1e3',
    '0x10',
    '1.5',
  ]) assert.throws(() => parseExpression(source, ['x', 'f']), undefined, source);
});

test('only explicitly declared identifiers are admitted and environment properties must be owned', () => {
  assert.throws(() => parseExpression('secret + 1', ['price']), /Unknown identifier/);
  assert.throws(() => parseExpression('constructor', []), /Unknown identifier/);
  assert.throws(() => parseExpression('_hidden', ['_hidden']), /Unsupported token/);
  assert.throws(() => parseExpression('pric\u0435', ['price']), /Unsupported token/);
  const expression = parseExpression('value + 1', ['value'], 'int');
  assert.throws(() => evaluateExpression(expression, {}), /Missing value/);
  assert.throws(() => evaluateExpression(expression, Object.create({ value: 99n })), /Missing value/);
  assert.equal(evaluateExpression(expression, { value: 2n }), 3n);
});

test('malformed syntax and trailing tokens are rejected rather than ignored', () => {
  for (const source of [
    '', '   ', '1 2', '1)', '(1', '()', '1 +', '* 1',
    'if true then 1', 'if true 1 else 2', 'if true then else 2',
    'if true then 1 else 2 else 3', '1 then 2', '1 + + 2',
  ]) assert.throws(() => parseExpression(source), undefined, JSON.stringify(source));
});

test('ill-typed expressions cannot enter execution or code emission', () => {
  for (const source of [
    '1 && 2', 'true || 0', 'true + 1', 'false * 2', 'true < false',
    '1 == true', '!1', '-false', 'if 1 then 2 else 3',
    'if true then 1 else false', '1 < 2 < 3',
  ]) assert.throws(() => parseExpression(source), undefined, source);
  assert.throws(() => parseExpression('1', [], 'bool'), /Expected bool/);
  assert.throws(() => parseExpression('true', [], 'int'), /Expected int/);
});

test('expression, token, and nesting budgets reject excess and admit their boundaries', () => {
  assert.equal(run(' '.repeat(15999) + '1'), 1n);
  assert.throws(() => parseExpression(' '.repeat(16000) + '1'), /at most 16000/);
  assert.throws(() => parseExpression(null), /Expression must be a string/);
  assert.throws(() => parseExpression({ toString: () => '1' }), /Expression must be a string/);
  assert.equal(run('9'.repeat(200)), BigInt('9'.repeat(200)));
  assert.throws(() => parseExpression('9'.repeat(201)), /Token too long/);
  assert.throws(() => parseExpression('identifier'.repeat(21), []), /Token too long/);
  assert.equal(run('('.repeat(63) + '1' + ')'.repeat(63)), 1n);
  assert.throws(() => parseExpression('('.repeat(64) + '1' + ')'.repeat(64)), /nesting exceeds 64/);
  assert.throws(() => parseExpression('-'.repeat(64) + '1'), /nesting exceeds 64/);
  assert.throws(() => parseExpression(Array(1502).fill('1').join('+')), /Too many tokens/);
});

test('canonical emission preserves expression meaning when parsed again', () => {
  const examples = [
    ['a - (b - 3) * 2', { a: 8n, b: 4n }],
    ['if a < 0 then -1 else if b == 0 then 0 else a / b', { a: 7n, b: -3n }],
    ['if true then (if false then 1 else 2) else 3', {}],
    ['!(a == b) && (a < 3 || b > 10)', { a: 2n, b: 5n }],
    ['-7 % -3', {}],
  ];
  for (const [source, environment] of examples) {
    const original = parseExpression(source, Object.keys(environment));
    const emitted = parseExpression(emitExpression(original), Object.keys(environment), original.type);
    assert.equal(evaluateExpression(emitted, environment), evaluateExpression(original, environment), source);
  }
});
