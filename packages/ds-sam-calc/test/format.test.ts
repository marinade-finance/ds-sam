import { pay } from '../src/format'

const NBSP = String.fromCharCode(0xa0)
// sol() formats in the runtime locale, so the decimal separator comes from it too
const fmt = (n: number, digits: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })

describe('pay', () => {
  it('pay(2.007, 3) → 2.007 SOL', () => {
    expect(pay(2.007, 3)).toBe(`${fmt(2.007, 3)}${NBSP}SOL`)
  })

  it('pay(1.2341, 3) → 1.235 SOL', () => {
    expect(pay(1.2341, 3)).toBe(`${fmt(1.235, 3)}${NBSP}SOL`)
  })

  it('pay(0.0001, 3) → 0.001 SOL', () => {
    expect(pay(0.0001, 3)).toBe(`${fmt(0.001, 3)}${NBSP}SOL`)
  })

  it('pay(1.2) → 2 SOL', () => {
    expect(pay(1.2)).toBe(`2${NBSP}SOL`)
  })

  it('pay(-1.2) → -1 SOL (ceil, toward +∞)', () => {
    expect(pay(-1.2)).toBe(`-1${NBSP}SOL`)
  })

  it('pay(0) → 0 SOL', () => {
    expect(pay(0)).toBe(`0${NBSP}SOL`)
  })

  it('pay(NaN) → 0 SOL (via finite)', () => {
    expect(pay(NaN)).toBe(`0${NBSP}SOL`)
  })
})
