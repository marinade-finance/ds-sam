import { AuctionConstraintType } from '../src'
import { isCapBinding, isConstraintBinding } from '../src/utils'

import type { AuctionConstraint } from '../src'

function makeConstraint(overrides: Partial<AuctionConstraint> = {}): AuctionConstraint {
  return {
    constraintType: AuctionConstraintType.COUNTRY,
    constraintName: 'US',
    totalStakeSol: 0,
    totalLeftToCapSol: 1,
    marinadeStakeSol: 0,
    marinadeLeftToCapSol: 1,
    validators: [],
    ...overrides,
  }
}

describe('isConstraintBinding', () => {
  it('BOND: totalLeftToCapSol Infinity, marinadeLeftToCapSol 0 → true', () => {
    const constraint = makeConstraint({
      constraintType: AuctionConstraintType.BOND,
      totalLeftToCapSol: Infinity,
      marinadeLeftToCapSol: 0,
    })
    expect(isConstraintBinding(constraint)).toBe(true)
  })

  it('COUNTRY: total 5000, marinade 0 → true', () => {
    const constraint = makeConstraint({ totalLeftToCapSol: 5_000, marinadeLeftToCapSol: 0 })
    expect(isConstraintBinding(constraint)).toBe(true)
  })

  it('both 1 → false', () => {
    const constraint = makeConstraint({ totalLeftToCapSol: 1, marinadeLeftToCapSol: 1 })
    expect(isConstraintBinding(constraint)).toBe(false)
  })

  it('marinade exactly EPSILON → false', () => {
    const constraint = makeConstraint({ totalLeftToCapSol: 1, marinadeLeftToCapSol: 1e-4 })
    expect(isConstraintBinding(constraint)).toBe(false)
  })

  it('total -5 (a COUNTRY constraint whose running total went negative) → true', () => {
    const constraint = makeConstraint({ totalLeftToCapSol: -5, marinadeLeftToCapSol: 1 })
    expect(isConstraintBinding(constraint)).toBe(true)
  })
})

describe('isCapBinding', () => {
  it('lastCapConstraint: null → false', () => {
    expect(isCapBinding({ lastCapConstraint: null })).toBe(false)
  })

  it('lastCapConstraint binding → true', () => {
    const constraint = makeConstraint({ totalLeftToCapSol: 5_000, marinadeLeftToCapSol: 0 })
    expect(isCapBinding({ lastCapConstraint: constraint })).toBe(true)
  })

  it('lastCapConstraint not binding → false', () => {
    const constraint = makeConstraint({ totalLeftToCapSol: 1, marinadeLeftToCapSol: 1 })
    expect(isCapBinding({ lastCapConstraint: constraint })).toBe(false)
  })
})
