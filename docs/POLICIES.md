# Pilot policy decisions

These requirements are explicit pilot defaults authored for this experiment. They are **not independently reviewed, human-certified business requirements**. Promoting a policy into a real application requires a domain owner to approve its behavior, examples, units, rounding, and error handling. Formal verification establishes consistency with the accepted contract; it cannot supply that approval.

`trusted/catalog.json` is the formal-contract and example baseline. `trusted/oracles.mjs` is a separate executable implementation of these policies for differential checks. They must receive independent review when a requirement changes; agreement between artifacts with common authorship does not establish that the requirement is right.

All functions are total over mathematical integers. Preconditions and domains are `true`; numerical inputs outside the policy's valid range produce `-1`. Valid results are nonnegative. Arguments at the package boundary must be supplied as exact integers, with no floating-point conversion or fixed-width truncation. Monetary values are integer minor units. Rates are integer basis points, with 10,000 representing 100%. No policy includes currency conversion, tax jurisdiction, calendar time zones, or hidden external state.

| Component | Accepted inputs and resulting behavior |
| --- | --- |
| Discount | Nonnegative price and rate from 0 through 10,000. Return the payable amount `floor(price × (10000 − bps) / 10000)`. Rounding applies to the payable amount. |
| AddTax | Nonnegative price and rate from 0 through 10,000. Return price plus `ceil(price × bps / 10000)`. |
| Prorate | Nonnegative amount, positive total, and used between zero and total inclusive. Return `floor(amount × used / total)`. |
| CeilDiv | Nonnegative amount and positive size. Return the number of size-sized units needed, rounding up; zero amount needs zero units. |
| Clamp | Nonnegative lower bound and upper bound at least lower. Value may be any integer, including negative. Clamp it into the inclusive bounds. |
| SaturatingSub | Nonnegative balance and debit. Subtract the debit and return zero if it exceeds the balance. |
| TransferRemaining | Nonnegative balance and amount, with amount no greater than balance. Return balance minus amount. Insufficient balance produces `-1`. |
| ShippingFee | Nonnegative subtotal, threshold, and fee. Charge the fee below threshold and zero at or above threshold. A zero threshold always grants free shipping. |
| LoyaltyPoints | Nonnegative spend and strictly positive points unit. Return whole units of spend, rounding down. |
| TierRate | Nonnegative quantity, threshold, and both rates. Below threshold select `low`; at or above threshold select `high`. Names identify branches: `high` is allowed to be numerically less than `low`. |
| LateFee | Nonnegative days, grace, daily rate, and cap. Charge nothing through the grace period; then charge `(days − grace) × rate`, limited to the cap. |
| RefundCap | Nonnegative requested refund and amount paid. Return the smaller amount. |
| InventoryAvailable | Nonnegative stock and reservation, with reservation no greater than stock. Return stock minus reserved. Overreservation produces `-1`. |
| ReorderQuantity | Nonnegative available and target. Return the positive shortfall to target, or zero when target is met. |
| IntervalOverlap | Nonnegative endpoints and each interval's end at least its start. Return the overlap length of two half-open intervals. Empty, disjoint, and merely touching intervals have zero overlap. |
| WithinWindow | Nonnegative start and end at least start. Value may be any integer, including negative. Return 1 exactly when `start <= value < end`, otherwise 0. Empty windows contain nothing. |
| LeapYear | Strictly positive year, using the proleptic Gregorian divisibility rule: multiples of 4 are leap years except multiples of 100, unless also multiples of 400. Return 1 or 0. There is no maximum year. |
| DaysInMonth | Strictly positive year and month from 1 through 12. Return the proleptic Gregorian month length, including the same leap-year rule. There is no maximum year. |
| MaxOfThree | Three nonnegative values. Return the largest, allowing equality. |
| MedianOfThree | Three nonnegative values. Return the middle order statistic, preserving repeated values. |

The fixed examples deliberately include invalid inputs, rounding edges, equality boundaries, ties, and integers greater than JavaScript's exact `Number` range. Samples drive bounded differential testing; they are not an exhaustive argument about unbounded integers. Witnesses demonstrate reachable non-error results; they do not establish adequate domain coverage. The trusted formulas cover error behavior as well as successful behavior so that candidates cannot gain acceptance by restricting their preconditions.

## Simulated requirements revision

`trusted/catalog-v2.json` adds a numeric input ceiling of **1,000,000,000,000 to every parameter**. Any argument above the ceiling returns `-1`; the original rules apply otherwise. The ceiling constrains inputs only, so a computed output can exceed it. Domains and preconditions stay `true`. Existing allowances for negative values in Clamp and WithinWindow remain; this change adds no lower limit beyond the original policies.

This v2 change is an artificial maintenance exercise, not an approved real-world requirement. Every component has an explicit formerly valid over-ceiling example that changes to `-1`, plus cap-boundary samples. `evaluate(id, args, 'v2')` applies the revised policy independently of both catalogs and candidate expressions. The experiment checks that stale v1 implementations fail against the revised requirements and that repaired implementations regain acceptance.
