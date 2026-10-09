import type { AuctionValidator, RevShare, Rewards } from './types'

// Field order is the key order of evaluation.json, which validator-bonds settles PSR events from
export type RevenueExpectation = {
  voteAccount: string
  expectedInflationCommission: number
  actualInflationCommission: number
  pastInflationCommission: number
  expectedMevCommission: number | null
  actualMevCommission: number | null
  pastMevCommission: number | null
  expectedNonBidPmpe: number
  actualNonBidPmpe: number
  expectedSamPmpe: number
  beforeSamCommissionIncreasePmpe: number
  maxSamStake: number | null
  samStakeShare: number
  lossPerStake: number
}

export type PastValidatorCommissions = {
  inflation: number
  mev: number | null
}

export type RevenueValidatorInput = Pick<
  AuctionValidator,
  'voteAccount' | 'inflationCommissionDec' | 'mevCommissionDec' | 'maxStakeWanted'
> &
  Partial<Pick<AuctionValidator, 'marinadeActivatedStakeSol'>> & {
    revShare: Pick<RevShare, 'inflationPmpe' | 'mevPmpe' | 'totalPmpe' | 'auctionEffectiveBidPmpe'>
  }

export type RevenueExpectationLogger = {
  warn: (message: string, context: object) => void
  debug: (message: string, context: object) => void
}

// The scoring API stores per-validator rows only, so a past run's clearing price is rebuilt from its winners
export const winningTotalPmpeOf = (rows: { marinadeSamTargetSol: number; revShare: { totalPmpe: number } }[]): number =>
  rows
    .filter(entry => entry.marinadeSamTargetSol > 0)
    .reduce((min, entry) => Math.min(min, entry.revShare.totalPmpe), Infinity)

export const evaluateRevenueExpectations = (
  validatorsBefore: RevenueValidatorInput[],
  validatorsAfter: RevenueValidatorInput[],
  winningTotalPmpe: number,
  pastValidatorCommissions: ReadonlyMap<string, PastValidatorCommissions>,
  rewards: Pick<Rewards, 'inflationPmpe' | 'mevPmpe'>,
  logger?: RevenueExpectationLogger,
): RevenueExpectation[] => {
  const evaluation: RevenueExpectation[] = []
  for (const validatorBefore of validatorsBefore) {
    const validatorAfter = validatorsAfter.find(v => v.voteAccount === validatorBefore.voteAccount)
    if (!validatorAfter) {
      logger?.warn('Validator not present in the snapshot!', {
        voteAccount: validatorBefore.voteAccount,
      })
      continue
    }

    // TODO: we are missing the information about blockCommission
    const expectedNonBidPmpe = validatorBefore.revShare.inflationPmpe + validatorBefore.revShare.mevPmpe
    const actualNonBidPmpe = validatorAfter.revShare.inflationPmpe + validatorAfter.revShare.mevPmpe

    // verification of commission increase (rug) at time before SAM was run in this epoch
    // validatorBefore is data when SAM was run, validatorAfter is data after SAM was run
    // this case manages the situation when validator increased commission in time-frame from start of epoch and running the SAM
    // if validator increased commission (in comparison to last epoch) AND his auction bid is under the winning PMPE
    // he requires to top up the difference that is not covered by the bid (the part within winning PMPE range is covered by the bid)
    let beforeSamCommissionIncreasePmpe = 0
    const lastEpochCommissions = pastValidatorCommissions.get(validatorBefore.voteAccount)
    // without the past snapshot data (--snapshot-past-validators-file-path) nothing is charged
    if (lastEpochCommissions != null && winningTotalPmpe > validatorBefore.revShare.totalPmpe) {
      const samInflationPmpe = validatorBefore.revShare.inflationPmpe
      const samMevPmpe = validatorBefore.revShare.mevPmpe
      const lastEpochInflationPmpe = rewards.inflationPmpe * (1.0 - lastEpochCommissions.inflation)
      const lastEpochMevPmpe =
        lastEpochCommissions.mev == null ? null : rewards.mevPmpe * (1.0 - lastEpochCommissions.mev)
      // combined delta: downstream charges combined non-bid PMPE, so a decrease in one commission offsets an increase in the other
      const lastEpochMevBasePmpe = lastEpochMevPmpe ?? samMevPmpe
      beforeSamCommissionIncreasePmpe = Math.max(
        0,
        lastEpochInflationPmpe + lastEpochMevBasePmpe - (samInflationPmpe + samMevPmpe),
      )
      if (beforeSamCommissionIncreasePmpe > 0) {
        logger?.debug('Validator increased commission before SAM run and has not won auction', {
          voteAccount: validatorBefore.voteAccount,
          inflationCommissionLastEpoch: lastEpochCommissions.inflation,
          mevCommissionLastEpoch: lastEpochCommissions.mev,
          lastEpochInflationPmpe,
          lastEpochMevPmpe,
          samInflationPmpe,
          samMevPmpe,
          beforeSamCommissionIncreasePmpe,
          winningPmpe: winningTotalPmpe,
          validatorTotalPmpe: validatorBefore.revShare.totalPmpe,
        })
      }
    }

    // validator-bonds settles on these numbers, so an unknown rate must not ship as a 0 or a 100%
    if (validatorBefore.inflationCommissionDec == null || validatorAfter.inflationCommissionDec == null) {
      logger?.warn('No resolvable inflation commission, skipping validator', {
        voteAccount: validatorBefore.voteAccount,
        marinadeActivatedStakeSol: validatorBefore.marinadeActivatedStakeSol,
      })
      continue
    }

    evaluation.push({
      voteAccount: validatorBefore.voteAccount,
      expectedInflationCommission: validatorBefore.inflationCommissionDec,
      actualInflationCommission: validatorAfter.inflationCommissionDec,
      // 0 may also mean missing past snapshot data; beforeSamCommissionIncreasePmpe is 0 in that case too
      pastInflationCommission: lastEpochCommissions?.inflation ?? 0,
      expectedMevCommission: validatorBefore.mevCommissionDec,
      actualMevCommission: validatorAfter.mevCommissionDec,
      pastMevCommission: lastEpochCommissions?.mev ?? null,
      expectedNonBidPmpe,
      actualNonBidPmpe,
      expectedSamPmpe: expectedNonBidPmpe + validatorBefore.revShare.auctionEffectiveBidPmpe,
      beforeSamCommissionIncreasePmpe,
      maxSamStake: validatorBefore.maxStakeWanted,
      samStakeShare: 1,
      lossPerStake: Math.max(0, expectedNonBidPmpe - actualNonBidPmpe) / 1000,
    })
  }

  return evaluation
}
