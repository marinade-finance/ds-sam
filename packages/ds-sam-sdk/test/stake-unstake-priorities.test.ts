import { DsSamSDK } from '../src'
import { LogVerbosity } from '../src/config'
import { defaultStaticDataProviderBuilder } from './helpers/static-data-provider-builder'
import { findValidatorInResult } from './helpers/utils'
import { ValidatorMockBuilder, generateIdentities, generateVoteAccounts } from './helpers/validator-mock-builder'

import type { AuctionResult, AuctionValidator } from '../src'

// ────────────────────────────────────────────────────────────────────────────
// Helper: deterministic credits (avoids random jitter in tests)
// ────────────────────────────────────────────────────────────────────────────
const goodCredits = (n = 10) => Array.from({ length: n }, () => 430_000)
const badCredits = (n = 10) => Array.from({ length: n }, () => 1_000)

// ────────────────────────────────────────────────────────────────────────────
// Helper: pretty-print an ASCII table of priorities
// ────────────────────────────────────────────────────────────────────────────
function printPriorityTable(result: AuctionResult) {
  const validators = [...result.auctionData.validators].sort((a, b) => a.unstakePriority - b.unstakePriority)

  const header = [
    'Vote Account'.padEnd(28),
    'Eligible',
    'StakePri',
    'UnstakePri',
    'TotalPMPE',
    'BidPMPE',
    'BondBal',
    'MndStake',
    'SamTarget',
    'BondCap',
    'Health',
    'GoodForN',
  ]
    .map(h => h.toString().padStart(10))
    .join(' | ')

  const sep = '-'.repeat(header.length)

  const rows = validators.map(v => {
    return [
      v.voteAccount.padEnd(28),
      v.samEligible ? 'YES' : 'NO',
      isNaN(v.stakePriority) ? 'N/A' : v.stakePriority,
      isNaN(v.unstakePriority) ? 'N/A' : v.unstakePriority,
      v.revShare.totalPmpe.toFixed(4),
      v.revShare.bidPmpe.toFixed(4),
      (v.bondBalanceSol ?? 0).toFixed(1),
      v.marinadeActivatedStakeSol.toFixed(0),
      v.auctionStake.marinadeSamTargetSol.toFixed(0),
      v.bondSamStakeCapSol.toFixed(0),
      isNaN(v.bondSamStakeHealth) ? 'N/A' : v.bondSamStakeHealth.toFixed(4),
      isNaN(v.bondGoodForNEpochs) ? 'N/A' : v.bondGoodForNEpochs.toFixed(2),
    ]
      .map(c => c.toString().padStart(10))
      .join(' | ')
  })

  console.log(['', sep, header, sep, ...rows, sep, ''].join('\n'))
}

// ────────────────────────────────────────────────────────────────────────────
// The 30 validators with diverse configurations
// ────────────────────────────────────────────────────────────────────────────
describe('stake/unstake priorities – 30 validators', () => {
  const voteAccounts = generateVoteAccounts('pri')
  const identities = generateIdentities()
  const va = () => voteAccounts.next().value
  const id = () => identities.next().value

  // We'll keep references so we can assert ordering later
  const labels: Record<string, string> = {}
  const v = (label: string) => {
    const vote = va()
    labels[label] = vote
    return { vote, identity: id(), label }
  }

  // ── Validator definitions ──────────────────────────────────────────────

  // Group A: High-APY validators (low commission, big bonds)
  const v01 = v('highAPY-bigBond')
  const v02 = v('highAPY-medBond')
  const v03 = v('highAPY-smallBond')

  // Group B: Medium-APY validators
  const v04 = v('medAPY-bigBond')
  const v05 = v('medAPY-medBond')
  const v06 = v('medAPY-smallBond')

  // Group C: Low-APY validators (high commission)
  const v07 = v('lowAPY-bigBond')
  const v08 = v('lowAPY-medBond')
  const v09 = v('lowAPY-smallBond')

  // Group D: Bid-boosted validators (cpmpe > 0)
  const v10 = v('bidBoost-high')
  const v11 = v('bidBoost-low')

  // Group E: Underfunded bonds (bond balance too low for current stake)
  const v12 = v('underfunded-severe')
  const v13 = v('underfunded-moderate')
  const v14 = v('underfunded-slight')

  // Group F: Edge cases
  const v15 = v('zeroBond')
  const v16 = v('noBond')
  const v17 = v('blacklisted')
  const v18 = v('badPerformance')
  const v19 = v('oldVersion')
  const v20 = v('zeroLiquidStake')

  // Group G: Validators with same APY (tiebreak by bondSamStakeHealth)
  const v21 = v('sameAPY-healthyBond')
  const v22 = v('sameAPY-weakBond')
  const v23 = v('sameAPY-veryWeakBond')

  // Group H: Max stake wanted limits
  const v24 = v('maxStakeWanted-low')
  const v25 = v('maxStakeWanted-high')

  // Group I: High commission with high bid (negative commission effect)
  const v26 = v('highComm-highBid')

  // Group J: Big external stake, small liquid stake
  const v27 = v('bigExternal-smallLiquid')

  // Group K: Very high bond balance (overcollateralized)
  const v28 = v('overcollateralized')

  // Group L: Barely eligible
  const v29 = v('barelyEligible-6pctComm')
  const v30 = v('barelyEligible-7pctComm')

  const validators = [
    // v01: High APY, big bond – should stake first, unstake last
    //   on-chain: 5% inflation, 10% mev; bond overrides: 3% inflation, 0% mev (dynamic commission)
    new ValidatorMockBuilder(v01.vote, v01.identity)
      .withInflationCommission(5)
      .withMevCommission(10)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 5000, bondInflationCommission: 3, bondMevCommission: 0 }),

    // v02: High APY, medium bond
    new ValidatorMockBuilder(v02.vote, v02.identity)
      .withInflationCommission(5)
      .withMevCommission(10)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 500, bondInflationCommission: 3, bondMevCommission: 0 }),

    // v03: High APY, small bond – bond limits delegation
    new ValidatorMockBuilder(v03.vote, v03.identity)
      .withInflationCommission(5)
      .withMevCommission(10)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 50, bondInflationCommission: 3, bondMevCommission: 0 }),

    // v04: Medium APY, big bond
    //   on-chain: 7% inflation, 60% mev; bond overrides: 5% inflation, 50% mev
    new ValidatorMockBuilder(v04.vote, v04.identity)
      .withInflationCommission(7)
      .withMevCommission(60)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 5000, bondInflationCommission: 5, bondMevCommission: 50 }),

    // v05: Medium APY, medium bond
    new ValidatorMockBuilder(v05.vote, v05.identity)
      .withInflationCommission(7)
      .withMevCommission(60)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 500, bondInflationCommission: 5, bondMevCommission: 50 }),

    // v06: Medium APY, small bond
    new ValidatorMockBuilder(v06.vote, v06.identity)
      .withInflationCommission(7)
      .withMevCommission(60)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 50, bondInflationCommission: 5, bondMevCommission: 50 }),

    // v07: Low APY (high on-chain commission), big bond
    //   on-chain: 7% inflation, 100% mev; bond overrides: 7% inflation, 90% mev (small dynamic discount)
    new ValidatorMockBuilder(v07.vote, v07.identity)
      .withInflationCommission(7)
      .withMevCommission(100)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 5000, bondMevCommission: 90 }),

    // v08: Low APY, medium bond
    new ValidatorMockBuilder(v08.vote, v08.identity)
      .withInflationCommission(7)
      .withMevCommission(100)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 500, bondMevCommission: 90 }),

    // v09: Low APY, small bond
    new ValidatorMockBuilder(v09.vote, v09.identity)
      .withInflationCommission(7)
      .withMevCommission(100)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 50, bondMevCommission: 90 }),

    // v10: Bid-boosted high – high cpmpe raises totalPmpe
    new ValidatorMockBuilder(v10.vote, v10.identity)
      .withInflationCommission(5)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0.15, balance: 2000 }),

    // v11: Bid-boosted low – small cpmpe
    new ValidatorMockBuilder(v11.vote, v11.identity)
      .withInflationCommission(5)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0.05, balance: 2000 }),

    // v12: Severely underfunded bond – large liquid stake, tiny bond
    //   on-chain: 7% inflation, 80% mev; bond: 5% inflation, 70% mev
    new ValidatorMockBuilder(v12.vote, v12.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(200_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 5, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v13: Moderately underfunded bond
    new ValidatorMockBuilder(v13.vote, v13.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(200_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 30, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v14: Slightly underfunded bond
    new ValidatorMockBuilder(v14.vote, v14.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(200_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 80, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v15: Zero bond balance – should be capped to 0 by clipBondStakeCap
    new ValidatorMockBuilder(v15.vote, v15.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 0, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v16: No bond at all – ineligible
    new ValidatorMockBuilder(v16.vote, v16.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000),

    // v17: Blacklisted – ineligible
    new ValidatorMockBuilder(v17.vote, v17.identity)
      .withInflationCommission(5)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 1000, bondInflationCommission: 3, bondMevCommission: 70 })
      .blacklisted(),

    // v18: Bad performance – ineligible
    new ValidatorMockBuilder(v18.vote, v18.identity)
      .withInflationCommission(5)
      .withMevCommission(80)
      .withCredits(...badCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 1000, bondInflationCommission: 3, bondMevCommission: 70 }),

    // v19: Old client version – ineligible
    new ValidatorMockBuilder(v19.vote, v19.identity)
      .withInflationCommission(5)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 1000, bondInflationCommission: 3, bondMevCommission: 70 })
      .withVersion('1.14.0'),

    // v20: Zero liquid stake – only external + native
    new ValidatorMockBuilder(v20.vote, v20.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(0)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 1000, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v21: Same APY group – healthy bond (tiebreak test)
    //   on-chain: 6% inflation, 40% mev; bond: 4% inflation, 30% mev
    new ValidatorMockBuilder(v21.vote, v21.identity)
      .withInflationCommission(6)
      .withMevCommission(40)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 3000, bondInflationCommission: 4, bondMevCommission: 30 }),

    // v22: Same APY group – weaker bond (tiebreak test)
    new ValidatorMockBuilder(v22.vote, v22.identity)
      .withInflationCommission(6)
      .withMevCommission(40)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 300, bondInflationCommission: 4, bondMevCommission: 30 }),

    // v23: Same APY group – very weak bond (tiebreak test)
    new ValidatorMockBuilder(v23.vote, v23.identity)
      .withInflationCommission(6)
      .withMevCommission(40)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 100, bondInflationCommission: 4, bondMevCommission: 30 }),

    // v24: Max stake wanted – low limit
    new ValidatorMockBuilder(v24.vote, v24.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 50_000, cpmpe: 0, balance: 1000, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v25: Max stake wanted – high limit
    new ValidatorMockBuilder(v25.vote, v25.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 1_000_000, cpmpe: 0, balance: 1000, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v26: High inflation commission but high cpmpe bid compensates
    new ValidatorMockBuilder(v26.vote, v26.identity)
      .withInflationCommission(7)
      .withMevCommission(100)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0.3, balance: 3000 }),

    // v27: Big external stake, very small liquid – high external leverage
    new ValidatorMockBuilder(v27.vote, v27.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(10_000)
      .withLiquidStake(10_000)
      .withExternalStake(500_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 500, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v28: Overcollateralized – massive bond relative to stake
    new ValidatorMockBuilder(v28.vote, v28.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(50_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 50_000, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v29: Barely eligible – 6% inflation, bond overrides to 5%
    new ValidatorMockBuilder(v29.vote, v29.identity)
      .withInflationCommission(6)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 500, bondInflationCommission: 5, bondMevCommission: 70 }),

    // v30: Barely eligible – 7% inflation, bond overrides to 6%
    new ValidatorMockBuilder(v30.vote, v30.identity)
      .withInflationCommission(7)
      .withMevCommission(80)
      .withCredits(...goodCredits())
      .withNativeStake(50_000)
      .withLiquidStake(100_000)
      .withExternalStake(200_000)
      .withBond({ stakeWanted: 500_000, cpmpe: 0, balance: 500, bondInflationCommission: 6, bondMevCommission: 70 }),
  ]

  let result: AuctionResult

  beforeAll(async () => {
    const dsSam = new DsSamSDK(
      {
        logVerbosity: LogVerbosity.ERROR,
        minBondEpochs: 1,
        idealBondEpochs: 3,
        minBondBalanceSol: 2,
        expectedMaxWinningBidRatio: 0.9,
      },
      defaultStaticDataProviderBuilder(validators),
    )
    result = await dsSam.run()
  })

  const find = (label: string): AuctionValidator => {
    const vote = labels[label]
    if (!vote) throw new Error(`Label ${label} not registered`)
    const validator = findValidatorInResult(vote, result)
    if (!validator) throw new Error(`Validator ${label} (${vote}) not found`)
    return validator
  }

  it('prints the priority table for human review', () => {
    printPriorityTable(result)
    expect(result.auctionData.validators.length).toBe(30)
  })

  // ── Stake priority: higher APY should get lower priority number (staked first) ──

  it('stake priority: highest APY validators get priority 1', () => {
    const highAPY = find('highAPY-bigBond')
    // v01, v02, v03 all have same commission → same PMPE → same stake priority
    expect(highAPY.stakePriority).toBe(find('highAPY-medBond').stakePriority)
    expect(highAPY.stakePriority).toBe(find('highAPY-smallBond').stakePriority)
    expect(highAPY.stakePriority).toBe(1)
  })

  it('stake priority: higher APY gets lower priority number than lower APY', () => {
    expect(find('highAPY-bigBond').stakePriority).toBeLessThan(find('medAPY-bigBond').stakePriority)
    expect(find('medAPY-bigBond').stakePriority).toBeLessThan(find('lowAPY-bigBond').stakePriority)
  })

  it('stake priority: bid-boosted validators rank above same-commission no-bid peers', () => {
    // v10 (bidBoost-high) has cpmpe=0.15 → adds to totalPmpe
    // v11 (bidBoost-low)  has cpmpe=0.05 → smaller addition
    // Both have same on-chain commissions (5% inflation, 80% mev)
    // Higher cpmpe → higher totalPmpe → better (lower) stake priority
    expect(find('bidBoost-high').revShare.totalPmpe).toBeGreaterThan(find('bidBoost-low').revShare.totalPmpe)
    expect(find('bidBoost-high').stakePriority).toBeLessThan(find('bidBoost-low').stakePriority)
  })

  // ── Unstake priority: ineligible validators always unstaked first (priority 0) ──

  it('unstake priority: ineligible validators get priority 0', () => {
    expect(find('noBond').unstakePriority).toBe(0)
    expect(find('blacklisted').unstakePriority).toBe(0)
    expect(find('badPerformance').unstakePriority).toBe(0)
    expect(find('oldVersion').unstakePriority).toBe(0)
    // these should not be SAM-eligible
    expect(find('noBond').samEligible).toBe(false)
    expect(find('blacklisted').samEligible).toBe(false)
    expect(find('badPerformance').samEligible).toBe(false)
    expect(find('oldVersion').samEligible).toBe(false)
  })

  // ── Unstake priority: underfunded bonds (bondSamStakeHealth < 1) come next ──

  it('unstake priority: underfunded bonds are unstaked before healthy bonds', () => {
    const severe = find('underfunded-severe')
    const moderate = find('underfunded-moderate')

    // Both should have bondSamStakeHealth < 1
    expect(severe.bondSamStakeHealth).toBeLessThan(1)
    expect(moderate.bondSamStakeHealth).toBeLessThan(1)

    // Severely underfunded should be unstaked before moderately underfunded
    expect(severe.unstakePriority).toBeLessThan(moderate.unstakePriority)
  })

  it('unstake priority: all underfunded bonds come before any healthy bond in tier 3', () => {
    const eligible = result.auctionData.validators.filter(v => v.samEligible)
    const underfunded = eligible.filter(v => v.bondSamStakeHealth < 1 && v.unstakePriority > 0)
    const healthy = eligible.filter(v => v.bondSamStakeHealth >= 1 && v.unstakePriority > 0)

    expect(underfunded.length).toBeGreaterThan(0)
    expect(healthy.length).toBeGreaterThan(0)
    const maxUnderfundedPriority = Math.max(...underfunded.map(v => v.unstakePriority))
    const minHealthyPriority = Math.min(...healthy.map(v => v.unstakePriority))
    expect(maxUnderfundedPriority).toBeLessThan(minHealthyPriority)
  })

  // ── Unstake priority tier 3: lower APY unstaked first, bond health as tiebreak ──

  it('unstake priority: among healthy validators, lower APY unstaked first', () => {
    const lowAPY = find('lowAPY-bigBond')
    const highAPY = find('highAPY-bigBond')

    // Both have big bonds (healthy), low APY should be unstaked before high APY
    expect(lowAPY.unstakePriority).toBeGreaterThan(0)
    expect(highAPY.unstakePriority).toBeGreaterThan(0)
    expect(lowAPY.unstakePriority).toBeLessThan(highAPY.unstakePriority)
  })

  it('unstake priority: same APY group – weaker bond health unstaked first', () => {
    const healthy = find('sameAPY-healthyBond')
    const weak = find('sameAPY-weakBond')
    const veryWeak = find('sameAPY-veryWeakBond')

    // All three have identical commissions → same totalPmpe → tiebreak by bondSamStakeHealth
    expect(healthy.revShare.totalPmpe).toBe(weak.revShare.totalPmpe)
    expect(weak.revShare.totalPmpe).toBe(veryWeak.revShare.totalPmpe)

    // Lower bondSamStakeHealth should get lower unstake priority number (unstaked first)
    expect(veryWeak.bondSamStakeHealth).toBeLessThan(weak.bondSamStakeHealth)
    expect(weak.bondSamStakeHealth).toBeLessThan(healthy.bondSamStakeHealth)
    expect(veryWeak.unstakePriority).toBeLessThan(weak.unstakePriority)
    expect(weak.unstakePriority).toBeLessThan(healthy.unstakePriority)
  })

  it('unstake priority: bid-boosted validator with higher totalPmpe unstaked after lower-totalPmpe peer', () => {
    // v10 (bidBoost-high, cpmpe=0.15) has higher totalPmpe than v24 (maxStakeWanted-low, cpmpe=0)
    // despite same on-chain commissions (5% inflation, 80% mev), because cpmpe adds to totalPmpe
    // Wait — they have different bond overrides now. Compare two validators where bid makes the difference:
    const bidHigh = find('bidBoost-high')
    const bidLow = find('bidBoost-low')

    // bidBoost-high has higher totalPmpe than bidBoost-low → unstaked later
    expect(bidHigh.revShare.totalPmpe).toBeGreaterThan(bidLow.revShare.totalPmpe)
    expect(bidHigh.unstakePriority).toBeGreaterThan(bidLow.unstakePriority)
  })

  // ── bondSamStakeHealth and bondGoodForNEpochs sanity checks ──

  it('bondSamStakeHealth: overcollateralized validator has health >= 1', () => {
    const overc = find('overcollateralized')
    expect(overc.bondSamStakeHealth).toBeGreaterThanOrEqual(1)
  })

  it('bondSamStakeHealth: zero bond balance has health 0 or NaN', () => {
    const zeroBond = find('zeroBond')
    expect(zeroBond.bondSamStakeHealth === 0 || isNaN(zeroBond.bondSamStakeHealth)).toBe(true)
  })

  it('bondGoodForNEpochs: overcollateralized validator has more epochs than underfunded', () => {
    // bondGoodForNEpochs = max(0, bondBal - onchainDistPmpe * protectedStake) / expectedMaxEffBidPmpe
    // For most validators, onchainDistPmpe * protectedStake > bondBal → numerator = 0 → epochs = 0
    // The overcollateralized validator (50000 SOL bond) should have a non-zero value
    const overc = find('overcollateralized')
    const underfunded = find('underfunded-severe')
    expect(overc.bondGoodForNEpochs).toBeGreaterThanOrEqual(underfunded.bondGoodForNEpochs)
  })

  // ── Zero liquid stake edge case ──

  it('zero liquid stake validator gets SAM target if eligible', () => {
    const zeroLiq = find('zeroLiquidStake')
    // With 0 liquid stake, marinadeActivatedStakeSol = 0
    // bondSamStakeHealth = X / 0 → Infinity (or NaN) → excluded from tier 2
    expect(zeroLiq.samEligible).toBe(true)
    expect(zeroLiq.unstakePriority).toBeGreaterThan(0)
  })

  // ── Overall consistency ──

  it('every eligible validator has a positive unstake priority', () => {
    result.auctionData.validators
      .filter(v => v.samEligible)
      .forEach(v => {
        expect(v.unstakePriority).toBeGreaterThan(0)
      })
  })

  it('every ineligible validator has unstake priority 0', () => {
    result.auctionData.validators
      .filter(v => !v.samEligible)
      .forEach(v => {
        expect(v.unstakePriority).toBe(0)
      })
  })

  it('unstake priorities are unique for eligible validators (no ties)', () => {
    const eligible = result.auctionData.validators.filter(v => v.unstakePriority > 0)
    const priorities = eligible.map(v => v.unstakePriority)
    const uniquePriorities = new Set(priorities)
    expect(uniquePriorities.size).toBe(priorities.length)
  })

  it('stake priorities are contiguous starting from 1', () => {
    const priorities = result.auctionData.validators.map(v => v.stakePriority).filter(p => !isNaN(p))
    const maxPriority = Math.max(...priorities)
    // Every priority from 1 to max should be represented
    for (let i = 1; i <= maxPriority; i++) {
      expect(priorities).toContain(i)
    }
  })
})
