# Architecture

## Overview

ds-sam implements a descending-price auction where validators
bid PMPE (price per mSOL epoch). Allocation proceeds from
lowest to highest PMPE until stake depletes or constraints
bind.

TypeScript monorepo:

- `packages/ds-sam-sdk`: Core auction logic (publishable NPM
  package)
- `src/`: NestJS CLI wrapper (nest-commander)

## Auction Algorithm

### Distribution Flow

1. **Eligibility filtering**: Remove validators below uptime
   threshold, wrong client version, or excessive commission
2. **PMPE grouping**: Group validators by total PMPE
   (inflation + MEV + bid + block)
3. **Descending iteration**: Iterate LOWEST to HIGHEST PMPE
   groups
4. **Even distribution**: Within each group, distribute
   evenly until constraints bind
5. **Constraint enforcement**: Remove capped validators,
   continue to next group
6. **Winning PMPE**: Last group to receive stake determines
   winning bid

### Even Distribution Mechanics

Within a PMPE group:

1. Calculate `minCap` across all constraints for all
   validators in group
2. Distribute `min(minCap, remainingStake / groupSize)` per
   validator
3. Update constraint state (consumed capacity)
4. Remove validators whose cap hit zero
5. Repeat until group empty or stake depleted

## Constraint System

Each constraint tracks total/Marinade stake and remaining
capacity. Constraints limit per-validator allocation.

### Types

**VALIDATOR**:
`maxMarinadeTvlSharePerValidatorDec * marinadeTVL`. Binding
for high-performing validators.

**COUNTRY**: Geographic concentration. Network cap +
Marinade cap, both configurable.

**ASO**: Infrastructure concentration. Same structure as
COUNTRY.

**BOND**: Protected stake cap =
`bondBalanceSol / (bondPmpe / 1000)` where:

```
bondPmpe = onchainDistributedPmpe + expectedMaxEffBidPmpe
           + minBondEpochs * expectedMaxEffBidPmpe
```

Hysteresis prevents flapping: <0.8x min = unstake,
0.8-1.0x = freeze, >=1.0x = normal.

**MAXSTAKEWANTED**: Validator-set hard limit on delegation.

## Bond Mechanics

Bonds cover PMPE obligations, not principal.

```
minBondPmpe  = onchainDistributedPmpe + expectedMaxEffBidPmpe
             + minBondEpochs * expectedMaxEffBidPmpe
idealBondPmpe = onchainDistributedPmpe + expectedMaxEffBidPmpe
             + idealBondEpochs * expectedMaxEffBidPmpe
protectedStakeCap = bondBalanceSol / (bondPmpe / 1000)
```

Production: `minBondEpochs=1`, `idealBondEpochs=12`.

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
  maxUnprotectedStakePerValidatorDec * (totalStake - selfStake - foundationStake),
  unprotectedValidatorStakeCapSol
)
if (cap < minUnprotectedStakeToDelegateSol) cap = 0
```

Protected = bond-backed. Unprotected = matching delegation,
no bond required, deducted from bond calculations.

## Unstake Priority

Three tiers (lower = unstake first):

1. Ineligible validators (`samEligible=false`) -> priority 0
2. Underfunded bonds (`bondSamHealth < 1`) sorted by health
   ascending
3. Funded bonds sorted by APY ascending, then health
   ascending

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
(self-executing). Bond obligation = additional PMPE from
bonds (bid + commission diffs).

```
onchainDistributedPmpe = onchainInflationPmpe + onchainMevPmpe
bondObligationPmpe     = bidPmpe + blockPmpe + bondInflationDiff + bondMevDiff
```

## Penalties

**Blacklist**: Newly blacklisted validator gets
`winningPmpe + min(3 * effParticipatingBidPmpe, winningPmpe)`.
Makes bid 2-4x uncompetitive but allows recovery.

**Bid too low**: Underbidding winning PMPE incurs penalty
based on historical bids.

## Data Provider

`packages/ds-sam-sdk/src/data-provider/`:

- Fetches validator info, bonds, TVL, blacklist, scoring
  from APIs
- Caches to local files for replay
  (`--cache-inputs --cache-dir-path`)
- `inputsSource`: `APIS` (live) or `FILES` (cached)
