// Formatting layer. All display rounding lives here — callers should NEVER
// `Math.round` a value before handing it to one of these functions.
// `toLocaleString` and `toFixed` both round half-away-from-zero, which is what
// we want for monetary display.

// Non-breaking space (U+00A0) between a number and its "SOL" unit so
// "19,866 SOL" never wraps across a line break. Applied to every "<n> SOL"
// output below.
const NBSP = String.fromCharCode(0xa0)

export const sol = (amount: number, digits = 0) =>
  amount.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

const pctString = (amount: number, fractionDigits: number = 2): string => `${(100 * amount).toFixed(fractionDigits)}%`

export const pct = (amount: number, fractionDigits: number = 2, maxValue: number = 1e18): string => {
  const n = finite(amount)
  if (n >= maxValue) {
    return `>${pctString(maxValue, fractionDigits)}`
  } else if (n <= -maxValue) {
    return `<-${pctString(maxValue, fractionDigits)}`
  }
  return pctString(n, fractionDigits)
}

export const finite = (x: number | null | undefined): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

export const pmpe = (x: number) => x.toFixed(5)
export const stake = (n: number) => `${sol(n, 0)}${NBSP}SOL`
// Fees / penalties / the user's bill. Always rounds UP so the displayed
// amount is never less than what will actually be charged. Defaults to 0
// decimals (tip-pill style); pass digits for receipt-precision rendering.
export const pay = (n: number, digits: number = 0) => {
  const p = Math.pow(10, digits)
  return `${sol(Math.ceil(finite(n) * p) / p, digits)}${NBSP}SOL`
}
export const penalty = (n: number) => `${sol(n, 3)}${NBSP}SOL`
// Cost rows need 3-decimal precision — per-epoch bid costs are often
// sub-1 SOL and rounding them to "0" or "1" reads as wrong.
export const cost = (n: number) => `${sol(n, 3)}${NBSP}SOL`

// Signed stake delta — "+1,234 SOL" / "−1,234 SOL" / "0 SOL". Uses the
// minus-sign unicode (−) for the negative case so the typography matches
// "+" in width; zero falls through to stake() with no sign.
export const signedStake = (n: number) => (n === 0 ? stake(0) : `${n > 0 ? '+' : '−'}${stake(Math.abs(n))}`)

// Bond balances and bond-side floor amounts — 1 decimal place, rounded
// DOWN. Always understate what's held (never overstate available bond)
// so the user can't be misled into thinking they have more cover than
// they do. Used for: bond balances, claimable bond, minimum bond
// required, bond held for bid payments, bond held for reward payouts.
export const bondSol = (n: number) =>
  `${(Math.floor(n * 10) / 10).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}${NBSP}SOL`

// Top-up advice — SOL the user is told to deposit into their bond.
// ALWAYS rounds UP (ceil): advising a rounded-down top-up would leave the
// bond short, so the validator stays under-collateralised and the advice
// is wrong. Any n > 0 yields at least "1 SOL" (never "0 SOL" / "<1 SOL").
// Callers guard with `> 0`; n <= 0 is never displayed.
export const topUp = (n: number) => `${Math.ceil(n)}${NBSP}SOL`
