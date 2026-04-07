# Architecture

## Overview

ds-sam implements a descending-price auction where validators bid
PMPE (price per mSOL epoch). Allocation proceeds from lowest to
highest PMPE until stake depletes or constraints bind.

TypeScript monorepo:

- `packages/ds-sam-sdk`: Core auction logic (NPM package)
- `src/`: NestJS CLI wrapper (nest-commander)

## Evaluation Flow

`Auction.evaluate()` orchestrates the full auction:

1. `updateExpectedMaxEffBidPmpe()` - estimate max winning bid
   via a preliminary auction run (when configured)
2. `updatePaidUndelegation()` - track forced undelegation costs
3. `evaluateOne()` - run the auction:
   a. `distributeSamStake()` - main auction distribution
   b. `distributeBackstopStake()` - backstop for zero-commission
4. `setStakeUnstakePriorities()` - order validators for un/staking
5. `setAuctionEffectiveBids()` - compute effective bids
6. `setEffParticipatingBids()` - participating bid amounts
7. `setBondRiskFee()` - charge risk fees for underfunded bonds
8. `setBidTooLowPenalties()` - penalize underbidding
9. `setMaxBondDelegations()` - max stake per bond
10. `setBlacklistPenalties()` - penalize blacklisted validators

## Auction Algorithm

### Distribution Flow

1. **Eligibility filtering**: Remove validators below uptime
   threshold, wrong client version, excessive commission,
   or missing bond account
2. **PMPE grouping**: Group validators by total PMPE
3. **Ascending iteration**: Iterate LOWEST to HIGHEST PMPE
4. **Even distribution**: Within each group, distribute evenly
   until constraints bind
5. **Constraint enforcement**: Remove capped validators, continue
6. **Winning PMPE**: Last group to receive stake = winning bid

### Even Distribution Mechanics

Within a PMPE group:

1. Calculate `minCap` across all constraints for all validators
2. Distribute `min(minCap, remainingStake / groupSize)` each
3. Update constraint state (consumed capacity)
4. Remove validators whose cap hit zero
5. Repeat until group empty or stake depleted

### Backstop Distribution

After SAM distribution, remaining stake goes to backstop-eligible
validators (zero-commission, when `enableZeroCommissionBackstop`
is set). Uses RISK constraints to cap per-validator allocation
at the unprotected stake cap.

## Constraint System

Each constraint tracks total/Marinade stake and remaining
capacity. Constraints limit per-validator allocation.

### Types

**VALIDATOR**: `maxMarinadeTvlSharePerValidatorDec * marinadeTVL`.
Binding for high-performing validators.

**COUNTRY**: Geographic concentration. Network cap + Marinade cap.

**ASO**: Infrastructure concentration. Same structure as COUNTRY.

**BOND**: Protected stake cap based on bond balance and PMPE
obligations:

```
bondPmpe = onchainDistributedPmpe + expectedMaxEffBidPmpe
           + minBondEpochs * expectedMaxEffBidPmpe
protectedStakeCap = bondBalanceSol / (bondPmpe / 1000)
```

Hysteresis prevents flapping: <0.8x min = unstake,
0.8-1.0x = freeze, >=1.0x = normal.

**WANT**: Validator-set hard limit on delegation
(`maxStakeWanted`). Clipped to `minMaxStakeWanted` floor.

**RISK**: Backstop constraint. Caps backstop allocation at the
unprotected stake cap per validator.

## Bond Mechanics

Bonds cover PMPE obligations, not principal.

```
minBondPmpe  = onchainDistributedPmpe + expectedMaxEffBidPmpe
             + minBondEpochs * expectedMaxEffBidPmpe
idealBondPmpe = onchainDistributedPmpe + expectedMaxEffBidPmpe
             + idealBondEpochs * expectedMaxEffBidPmpe
protectedStakeCap = bondBalance / (bondPmpe / 1000)
```

Production: `minBondEpochs=4`, `idealBondEpochs=12`.

Unprotected stake reserve is subtracted from bond balance before
computing protected stake cap.

`bondObligationSafetyMult` (config, range [1.0, 2.0]) scales
bond balance requirements for constraint calculations.

### Bond Risk Fee

When a validator's bond is underfunded relative to its stake,
a risk fee is charged:

```
bondRiskFeeSol = bondRiskFeeMult * exposedStake * feeCoef
```

Where `exposedStake` is the stake exceeding bond coverage
and `feeCoef` derives from the bond obligation PMPE.
Set `bondRiskFeeMult=0` to disable.

### Health

```
bondGoodForNEpochs = (bondBalance - onchainPmpe * protectedStake)
                   / expectedMaxBidPmpe
bondSamHealth = (1.1 * (minLimit + unprotectedStake))
              / (1 + marinadeStake) / correction
```

Health < 1.0 triggers priority unstaking.

## Unprotected Stake

Per-validator matching stake covering existing delegation
without bond protection.

```
cap = min(
  unprotectedValidatorStakeCapSol,
  unprotectedDelegatedStakeDec * (totalStake - selfStake
    - foundationStake)
  + unprotectedFoundationStakeDec * foundationStake
)
if (cap < minUnprotectedStakeToDelegateSol) cap = 0
```

Protected = bond-backed. Unprotected = matching delegation,
no bond required, deducted from bond calculations.

## Unstake Priority

Three tiers (lower = unstake first):

1. Ineligible validators (`samEligible=false`) -> priority 0
2. Underfunded bonds (`bondSamHealth < 1`) by health ascending
3. Funded bonds by APY ascending, then health ascending

## PMPE Composition

```
totalPmpe = inflationPmpe + mevPmpe + bidPmpe + blockPmpe

inflationPmpe = inflationRewards * (1 - inflationCommission)
mevPmpe       = mevRewards * (1 - mevCommission)
bidPmpe       = max(0, bidCpmpe)
blockPmpe     = blockRewards * (1 - blockRewardsCommission)
```

### On-chain vs Bond Obligation

On-chain distributed = what validators pay via commissions
(self-executing). Bond obligation = additional PMPE from bonds
(bid + commission diffs).

```
onchainDistributedPmpe = onchainInflationPmpe + onchainMevPmpe
bondObligationPmpe = bidPmpe + blockPmpe
                   + bondInflationDiff + bondMevDiff
```

## Penalties

**Blacklist**: Newly blacklisted validator gets
`winningPmpe + min(3 * effParticipatingBidPmpe, winningPmpe)`.
Makes bid 2-4x uncompetitive but allows recovery.

**Bid too low**: Underbidding winning PMPE incurs penalty based
on historical bids. A permitted deviation
(`bidTooLowPenaltyPermittedDeviationPmpe`) allows slight
underbidding without penalty.

## Data Provider

`packages/ds-sam-sdk/src/data-provider/`:

- Fetches validator info, bonds, TVL, blacklist, scoring, and
  commission overrides from APIs
- Caches to local files for replay
  (`--cache-inputs --cache-dir-path`)
- `inputsSource`: `APIS` (live) or `FILES` (cached)
