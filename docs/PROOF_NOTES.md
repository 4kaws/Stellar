# Candidate proof notes

These are English explanations of the baseline and refactor candidates. They are **not machine-checked proofs** and are not acceptance evidence on their own. The generated Dafny obligations connect the actual candidate expression to the separately maintained contract; successful verifier output is the formal evidence.

## Shared assumptions and limits

Inputs and results are unbounded mathematical integers. Invalid inputs return `-1`; valid results are nonnegative. Each implementation is total, including on invalid inputs, and checks validity before dividing. Integer division on the admitted nonnegative numerators and strictly positive denominators rounds down. Dates use the proleptic Gregorian calendar with strictly positive years. No claim covers floating point, fixed-width overflow, time zones, deployment behavior, or an independently translated implementation.

The trusted policies are documented in [POLICIES.md](POLICIES.md). Their correctness as business requirements requires owner review. These candidates cannot authorize a specification change.

| Component | Intended argument and assumptions |
| --- | --- |
| `discount` | A nonnegative price and a rate from 0 through 10,000 basis points give a nonnegative retained fraction. Multiplication followed by division by 10,000 rounds the final price down. Distributing multiplication leaves the refactor numerator unchanged. |
| `add_tax` | The admitted tax numerator is nonnegative. Adding 9,999 before division by 10,000 rounds tax upward, including exactly divisible and zero cases. Moving the integral price into the numerator preserves the result because the denominator divides `price * 10000`. |
| `prorate` | A positive total and usage between zero and total make division defined and keep the result between zero and the amount. Commuting the numerator factors preserves the quotient. |
| `ceil_div` | For nonnegative amount and positive size, `(amount + size - 1) / size` is the least number of whole units covering the amount. Reassociating the numerator preserves it, including amount zero. |
| `clamp` | Ordered nonnegative bounds split inputs into below, inside, and above the interval. The below and above cases cannot both hold, so testing them in reverse order preserves the returned bound or value. The input value itself may be negative. |
| `saturating_sub` | Nonnegative operands yield zero when the debit exceeds the balance and the exact nonnegative difference otherwise. The refactor exchanges the two exhaustive comparison branches. |
| `transfer_remaining` | A nonnegative amount no greater than the balance implies that the balance is nonnegative too. The refactor omits only that redundant validity check and rewrites subtraction as addition of the negative amount. |
| `shipping_fee` | Nonnegative inputs permit exactly two threshold branches: subtotal at or above the threshold is free; the lower branch returns the fee. Strictly below is the complement of at or above. |
| `loyalty_points` | A nonnegative spend and positive unit give the number of complete reward units by floor division. Reordering validation and adding zero preserve the result. |
| `tier_rate` | Both rates, quantity, and threshold are nonnegative. Equality belongs to the high-rate branch. Swapping the complementary threshold branches preserves this policy without assuming any ordering between the rates. |
| `late_fee` | Admitted days, grace, rate, and cap are nonnegative. Days within grace give zero; later days produce a nonnegative charge capped at the cap. Reversing complementary comparisons leaves the cap boundary unchanged. |
| `refund_cap` | With nonnegative requested and paid amounts, returning the smaller cannot exceed either. Swapping comparison direction preserves equality because both values are identical there. |
| `inventory_available` | A nonnegative reservation no greater than stock also establishes nonnegative stock. The remaining stock is the exact difference; the refactor removes the implied guard and rewrites subtraction. |
| `reorder_quantity` | Nonnegative available and target values require the positive shortfall when below target and zero otherwise. Testing the complementary comparison first preserves equality at zero. |
| `interval_overlap` | Nonnegative ordered endpoints describe half-open intervals. The intersection starts at the larger start and ends at the smaller end. Its length is their positive difference, or zero when disjoint or touching. Reversing the min/max comparisons changes only the selected operand on equal values, so the result is identical. |
| `within_window` | A nonnegative start and ordered end define a half-open window; any integer value is allowed. Outside means below start or at/above end, the exact complement of the membership condition. Empty windows accept no values. |
| `leap_year` | For a positive year, Gregorian leap years are multiples of 400 or multiples of 4 that are not multiples of 100. The refactor explicitly prioritizes the 400-year exception, then the century exclusion, then the four-year rule. |
| `days_in_month` | A positive year and month from 1 through 12 cover February, the four 30-day months, and all remaining 31-day months. February uses the same Gregorian rule as `leap_year`. The refactor reorders disjoint month cases and expands the leap-year condition. |
| `max_of_three` | Nonnegative inputs ensure a nonnegative selected result. The baseline chooses an input at least as large as both others; the refactor compares a and b first and then compares their winner with c. |
| `median_of_three` | Nonnegative inputs are split by the order of the first two values and then by the third value's position. Every branch chooses the middle value, including ties. The refactor reverses the initial ordering partition and uses the corresponding symmetric branches. |

## Deliberate failure fixture

`candidates/wrong-discount.json` changes the valid discount result by adding one. It is intentionally incorrect. The unchanged discount contract and expected-result tests should reject it; it must never be accepted or shipped as a library.

## Maintenance experiment

`candidates/refactor.json` supplies a behavior-preserving change for every component. Acceptance requires rechecking the unchanged trusted specifications, all specification examples, compiled behavior, and all mandatory audits. This exercises proof and evidence repair without changing requirements.

`candidates/requirements-v2.json` exercises a **simulated** requirement revision across all 20 components: an input greater than `1000000000000` now returns `-1`; all behavior for inputs at or below that limit is unchanged. This is an experiment policy, not an owner-approved real business requirement or a machine-integer safety guarantee. Negative inputs still follow each component's existing rules, including unrestricted negative `value` inputs in clamp/window operations. Multiplication may still produce intermediate values above the new input limit.

The v2 argument is a two-way case split. If any parameter exceeds the new upper bound, the candidate returns the required sentinel immediately. Otherwise the original implementation runs, so its original proof obligations apply. The revised contract and independent boundary examples must be reviewed and versioned separately. The experiment should reject the old behavior on newly invalid inputs and accept the revised candidate only against the revised contract.
