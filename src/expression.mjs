// An intentionally small subset of Dafny expressions. No source text is executed.
const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const booleans = new Set(['&&', '||']);
const comparisons = new Set(['<', '<=', '>', '>=']);

export function parseExpression(source, variables = [], expectedType) {
  if (typeof source !== 'string' || source.length > 16000) throw new Error('Expression must be a string of at most 16000 characters');
  const tokens = []; let offset = 0;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { offset += whitespace[0].length; continue; }
    const match = /^(?:[0-9]+|[A-Za-z][A-Za-z0-9_]*|&&|\|\||==|!=|<=|>=|[()+\-*\/%!<>])/.exec(rest);
    if (!match) throw new Error(`Unsupported token at character ${offset}`);
    if (match[0].length > 200) throw new Error('Token too long');
    tokens.push(match[0]); offset += match[0].length;
    if (tokens.length > 3000) throw new Error('Too many tokens');
  }
  let index = 0; let depth = 0;
  const take = token => { if (tokens[index++] !== token) throw new Error(`Expected '${token}'`); };
  const vars = new Set(variables);
  function parse(min = 0) {
    if (++depth > 64) throw new Error('Expression nesting exceeds 64');
    let left; const token = tokens[index++];
    if (token === 'if') {
      const condition = parse(); take('then'); const yes = parse(); take('else'); const no = parse();
      if (condition.type !== 'bool' || yes.type !== no.type) throw new Error('Ill-typed conditional');
      left = { kind: 'if', condition, yes, no, type: yes.type };
    } else if (token === '(') { left = parse(); take(')'); }
    else if (token === '-' || token === '!') {
      const value = parse(7); const type = token === '!' ? 'bool' : 'int';
      if (value.type !== type) throw new Error('Ill-typed unary expression');
      left = { kind: 'unary', op: token, value, type };
    } else if (token === 'true' || token === 'false') left = { kind: 'bool', value: token === 'true', type: 'bool' };
    else if (token && /^[0-9]+$/.test(token)) left = { kind: 'int', value: BigInt(token).toString(), type: 'int' };
    else if (vars.has(token)) left = { kind: 'variable', name: token, type: 'int' };
    else throw new Error(`Unknown identifier or missing expression: ${token ?? '<end>'}`);
    while (Object.hasOwn(precedence, tokens[index]) && precedence[tokens[index]] >= min) {
      const op = tokens[index++]; const right = parse(precedence[op] + 1);
      if (booleans.has(op) && (left.type !== 'bool' || right.type !== 'bool')) throw new Error('Boolean operands required');
      if (!booleans.has(op) && op !== '==' && op !== '!=' && (left.type !== 'int' || right.type !== 'int')) throw new Error('Integer operands required');
      if ((op === '==' || op === '!=') && left.type !== right.type) throw new Error('Equality operands must have the same type');
      const type = booleans.has(op) || comparisons.has(op) || op === '==' || op === '!=' ? 'bool' : 'int';
      left = { kind: 'binary', op, left, right, type };
    }
    depth--; return left;
  }
  const result = parse();
  if (index !== tokens.length) throw new Error(`Unexpected token '${tokens[index]}'`);
  if (expectedType && result.type !== expectedType) throw new Error(`Expected ${expectedType}, received ${result.type}`);
  return result;
}

export function emitExpression(ast) {
  switch (ast.kind) {
    case 'int': return ast.value;
    case 'bool': return String(ast.value);
    case 'variable': return ast.name;
    case 'unary': return `(${ast.op}${emitExpression(ast.value)})`;
    case 'binary': return `(${emitExpression(ast.left)} ${ast.op} ${emitExpression(ast.right)})`;
    case 'if': return `(if ${emitExpression(ast.condition)} then ${emitExpression(ast.yes)} else ${emitExpression(ast.no)})`;
    default: throw new Error('Unknown AST kind');
  }
}

// Dafny integers use Euclidean division: the remainder is always nonnegative.
export function euclideanDiv(a, b) {
  if (b === 0n) throw new Error('Division by zero');
  let q = a / b;
  if (a % b < 0n) q += b > 0n ? -1n : 1n;
  return q;
}

export function evaluateExpression(ast, environment) {
  const ev = child => evaluateExpression(child, environment);
  switch (ast.kind) {
    case 'int': return BigInt(ast.value);
    case 'bool': return ast.value;
    case 'variable': {
      if (!Object.hasOwn(environment, ast.name)) throw new Error(`Missing ${ast.name}`);
      return environment[ast.name];
    }
    case 'if': return ev(ast.condition) ? ev(ast.yes) : ev(ast.no);
    case 'unary': return ast.op === '!' ? !ev(ast.value) : -ev(ast.value);
    case 'binary': {
      const a = ev(ast.left);
      if (ast.op === '&&') return a && ev(ast.right);
      if (ast.op === '||') return a || ev(ast.right);
      const b = ev(ast.right);
      switch (ast.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': return euclideanDiv(a, b); case '%': return a - b * euclideanDiv(a, b);
        case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
        case '==': return a === b; case '!=': return a !== b;
      }
    }
  }
  throw new Error('Unknown expression');
}
