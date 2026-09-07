/**
 * Executable policy oracles maintained independently of candidate expressions.
 * Inputs and outputs are mathematical integers represented with JavaScript BigInt.
 * This module never reads the candidate or the formal contract.
 */

const invalid = -1n;
const anyNegative = (values) => values.some((value) => value < 0n);
const leap = (year) => year % 400n === 0n || (year % 4n === 0n && year % 100n !== 0n);

const rules = {
  discount: ([price, bps]) => {
    if (price < 0n || bps < 0n || bps > 10000n) return invalid;
    return (price * (10000n - bps)) / 10000n;
  },
  add_tax: ([price, bps]) => {
    if (price < 0n || bps < 0n || bps > 10000n) return invalid;
    const taxNumerator = price * bps;
    const wholeTax = taxNumerator / 10000n;
    const remainder = taxNumerator % 10000n;
    return price + wholeTax + (remainder === 0n ? 0n : 1n);
  },
  prorate: ([amount, used, total]) => {
    if (amount < 0n || used < 0n || total <= 0n || used > total) return invalid;
    return (amount * used) / total;
  },
  ceil_div: ([amount, size]) => {
    if (amount < 0n || size <= 0n) return invalid;
    const whole = amount / size;
    return whole + (amount % size === 0n ? 0n : 1n);
  },
  clamp: ([value, lower, upper]) => {
    if (lower < 0n || upper < lower) return invalid;
    if (value < lower) return lower;
    if (value > upper) return upper;
    return value;
  },
  saturating_sub: ([balance, debit]) => {
    if (anyNegative([balance, debit])) return invalid;
    const remaining = balance - debit;
    return remaining > 0n ? remaining : 0n;
  },
  transfer_remaining: ([balance, amount]) => {
    if (anyNegative([balance, amount])) return invalid;
    if (amount > balance) return invalid;
    return balance - amount;
  },
  shipping_fee: ([subtotal, threshold, fee]) => {
    if (anyNegative([subtotal, threshold, fee])) return invalid;
    return subtotal < threshold ? fee : 0n;
  },
  loyalty_points: ([spend, unit]) => {
    if (spend < 0n || unit <= 0n) return invalid;
    return spend / unit;
  },
  tier_rate: ([quantity, threshold, low, high]) => {
    if (anyNegative([quantity, threshold, low, high])) return invalid;
    if (quantity < threshold) return low;
    return high;
  },
  late_fee: ([days, grace, rate, cap]) => {
    if (anyNegative([days, grace, rate, cap])) return invalid;
    if (days <= grace) return 0n;
    const uncapped = (days - grace) * rate;
    return uncapped > cap ? cap : uncapped;
  },
  refund_cap: ([requested, paid]) => {
    if (anyNegative([requested, paid])) return invalid;
    return requested < paid ? requested : paid;
  },
  inventory_available: ([stock, reserved]) => {
    if (anyNegative([stock, reserved]) || reserved > stock) return invalid;
    return stock - reserved;
  },
  reorder_quantity: ([available, target]) => {
    if (anyNegative([available, target])) return invalid;
    return target > available ? target - available : 0n;
  },
  interval_overlap: ([aStart, aEnd, bStart, bEnd]) => {
    if (anyNegative([aStart, aEnd, bStart, bEnd])) return invalid;
    if (aStart > aEnd || bStart > bEnd) return invalid;
    const left = aStart > bStart ? aStart : bStart;
    const right = aEnd < bEnd ? aEnd : bEnd;
    return right > left ? right - left : 0n;
  },
  within_window: ([value, start, end]) => {
    if (start < 0n || end < start) return invalid;
    return value >= start && value < end ? 1n : 0n;
  },
  leap_year: ([year]) => {
    if (year <= 0n) return invalid;
    return leap(year) ? 1n : 0n;
  },
  days_in_month: ([year, month]) => {
    if (year <= 0n || month < 1n || month > 12n) return invalid;
    if (month === 2n && leap(year)) return 29n;
    return [31n, 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n][Number(month - 1n)];
  },
  max_of_three: (values) => {
    if (anyNegative(values)) return invalid;
    return values.reduce((maximum, value) => value > maximum ? value : maximum);
  },
  median_of_three: (values) => {
    if (anyNegative(values)) return invalid;
    const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    return sorted[1];
  },
};

const arities = {
  discount: 2, add_tax: 2, prorate: 3, ceil_div: 2, clamp: 3,
  saturating_sub: 2, transfer_remaining: 2, shipping_fee: 3, loyalty_points: 2,
  tier_rate: 4, late_fee: 4, refund_cap: 2, inventory_available: 2,
  reorder_quantity: 2, interval_overlap: 4, within_window: 3, leap_year: 1,
  days_in_month: 2, max_of_three: 3, median_of_three: 3,
};

export function evaluate(id, args, policyVersion = 'v1') {
  if (!Object.hasOwn(rules, id)) throw new Error(`Unknown policy oracle: ${id}`);
  if (!Array.isArray(args) || args.length !== arities[id] || args.some((value) => typeof value !== 'bigint')) {
    throw new TypeError(`${id} requires ${arities[id]} BigInt arguments`);
  }
  if (policyVersion !== 'v1' && policyVersion !== 'v2') throw new Error(`Unknown policy version: ${policyVersion}`);
  if (policyVersion === 'v2' && args.some((value) => value > 1000000000000n)) return invalid;
  return rules[id](args);
}
