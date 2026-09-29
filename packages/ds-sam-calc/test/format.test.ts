import { pay } from '../src/format'

const NBSP = String.fromCharCode(0xa0)

describe('pay', () => {
  it('pay(2.007, 3) → 2.007 SOL', () => {
    expect(pay(2.007, 3)).toBe(`2.007${NBSP}SOL`)
  })

  it('pay(1.2341, 3) → 1.235 SOL', () => {
    expect(pay(1.2341, 3)).toBe(`1.235${NBSP}SOL`)
  })

  it('pay(0.0001, 3) → 0.001 SOL', () => {
    expect(pay(0.0001, 3)).toBe(`0.001${NBSP}SOL`)
  })

  it('pay(1.2) → 2 SOL', () => {
    expect(pay(1.2)).toBe(`2${NBSP}SOL`)
  })

  it('pay(0) → 0 SOL', () => {
    expect(pay(0)).toBe(`0${NBSP}SOL`)
  })

  it('pay(NaN) → 0 SOL (via finite)', () => {
    expect(pay(NaN)).toBe(`0${NBSP}SOL`)
  })
})
