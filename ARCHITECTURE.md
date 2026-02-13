# Architecture

## Overview

ds-sam implements Marinade's stake auction as a descending-price auction where validators bid PMPE (price per mSOL epoch) and allocation proceeds from lowest to highest PMPE until stake depletes or constraints bind.

TypeScript monorepo:

- `packages/ds-sam-sdk`: Core auction logic (publishable NPM package)
- `src/`: NestJS CLI wrapper using nest-commander

## Auction Algorithm

### Distribution Flow

1. **Eligibility filtering**: Remove validators below uptime threshold, wrong client version, or excessive commission
2. **PMPE grouping**: Group validators by total PMPE (inflation + MEV + bid + block rewards)
3. **Descending iteration**: Iterate from LOWEST to HIGHEST PMPE groups
4. **Even distribution**: Within each group, distribute stake evenly until constraints bind
5. **Constraint enforcement**: Remove capped validators, continue to next PMPE group
6. **Winning PMPE**: Last group to receive stake determines winning bid

Counter-intuitive: Algorithm iterates lowest→highest PMPE, but winning bid is highest PMPE that got stake.

### Even Distribution Mechanics

Within a PMPE group:

1. Calculate `minCap` across all active constraints for all validators in group
2. Distribute `min(minCap, remainingStake / groupSize)` to each validator
3. Update constraint state (consumed capacity)
4. Remove validators whose cap dropped to zero
5. Repeat until group empty or stake depleted

## Constraint System

Constraints limit stake allocation. Each constraint tracks:

- `totalStakeSol`: Total network stake under this constraint
- `totalLeftToCapSol`: Remaining capacity before hitting network-wide cap
- `marinadeStakeSol`: Current Marinade stake under constraint
- `marinadeLeftToCapSol`: Remaining Marinade capacity
- `validators`: List of validators affected by this constraint

### Constraint Types

**VALIDATOR** (per-validator cap):

- Cap = `maxMarinadeTvlSharePerValidatorDec * marinadeTVL`
- Production default: 4% (recently analyzed 8% increase)
- Binding constraint for high-performing validators

**COUNTRY** (geographic concentration):

- Network cap: `maxNetworkStakeConcentrationPerCountryDec * networkStake`
- Marinade cap: `maxMarinadeStakeConcentrationPerCountryDec * marinadeTVL`
- Production default: 30% network stake per country
- Prevents geographic risk concentration

**ASO** (infrastructure concentration):

- Network cap: `maxNetworkStakeConcentrationPerAsoDec * networkStake`
- Marinade cap: `maxMarinadeStakeConcentrationPerAsoDec * marinadeTVL`
- Production default: 30% network stake per ASO
- Prevents hosting provider concentration

**BOND** (bond-backed stake):

- Protected stake cap: `bondBalanceSol / (bondPmpe / 1000)`
- `bondPmpe` = `onchainDistributedPmpe + expectedMaxEffBidPmpe + (minBondEpochs * expectedMaxEffBidPmpe)`
- Ideal reserve: 12 epochs of PMPE coverage
- Minimum reserve: 1 epoch
- Hysteresis: 0.8x `minBondBalanceSol` triggers full unstake, 0.8-1.0x freezes stake

**MAXSTAKEWANTED** (validator opt-out):

- Validators set `maxStakeWanted` to limit delegation
- Cap enforced as hard limit on total Marinade stake

## Bond Mechanics

### Coverage Calculation

Bonds cover PMPE obligations, not principal. Three layers:

1. **On-chain commission**: Paid automatically from inflation rewards
2. **Bond obligation**: Additional PMPE paid from bond claims (bid + commission overrides)
3. **Reserve**: Buffer for N epochs of PMPE coverage

```typescript
minBondPmpe = onchainDistributedPmpe + expectedMaxEffBidPmpe + minBondEpochs * expectedMaxEffBidPmpe
idealBondPmpe = onchainDistributedPmpe + expectedMaxEffBidPmpe + idealBondEpochs * expectedMaxEffBidPmpe
protectedStakeCap = bondBalanceSol / (bondPmpe / 1000)
```

Production config: `minBondEpochs=1`, `idealBondEpochs=12`. Current bids yield ~17 epochs coverage.

### Bond Health

```typescript
bondGoodForNEpochs = (bondBalance - onchainPmpe * protectedStake) / expectedMaxBidPmpe
bondSamHealth = (1.1 * (minLimit + unprotectedStake)) / (1 + marinadeStake) / correction
```

Health < 1.0 triggers priority unstaking (lower priority = unstake first).

### Hysteresis (Stake Flapping Prevention)

- `bondBalance < 0.8 * minBondBalance`: Cap = 0 (full unstake)
- `0.8 * minBondBalance ≤ bondBalance < minBondBalance`: Cap = current stake (freeze)
- `bondBalance ≥ minBondBalance`: Normal cap calculation

## Unprotected Stake

Per-validator matching stake that covers existing delegation without bond protection.

### Calculation

```typescript
unprotectedStakeCap = min(
  maxUnprotectedStakePerValidatorDec * (totalStake - selfStake - foundationStake),
  unprotectedValidatorStakeCapSol, // global per-validator cap
)
if (cap < minUnprotectedStakeToDelegateSol) cap = 0
```

### Protected vs Unprotected

**Protected stake**: Bond-backed. Requires `bondPmpe` coverage.
**Unprotected stake**: Matching delegation. No bond required. Deducted from bond calculations.

Dashboard shows ~93% protected (total protected / total Marinade stake).
Auction calculates per-validator unprotected cap based on existing delegation.

### Why Unprotected Appears High

Per-validator cap (e.g., 6% of delegated stake) × 70 validators = aggregate unprotected capacity appears large. Actual unprotected stake deployed:

```typescript
actualUnprotected = max(0, targetStake - bondOnlyCap)
```

If bond covers full target, unprotected = 0 even when cap allows it.

### Target Protected Stake Metric (TODO)

Dashboard should show "Target Protected Stake" = stake intended to be protected (excludes unprotected cap). Current "Protected Stake %" uses actual deployed unprotected, masking per-validator caps.

## Unstake Priority

Three-tier system (lower = unstake first):

1. **Tier 0**: Ineligible validators (`samEligible=false`) → priority 0
2. **Tier 1-N**: Underfunded bonds (`bondSamHealth < 1`) sorted by health ascending
3. **Tier N+**: Funded bonds sorted by (APY ascending, health ascending)

Counter-intuitive: Lower APY unstaked first (worse deal for Marinade, but maintains competition).

## PMPE Composition

Total PMPE = inflation + MEV + bid + block production rewards

```typescript
totalPmpe = inflationPmpe + mevPmpe + bidPmpe + blockPmpe

inflationPmpe = inflationRewards * (1 - inflationCommission)
mevPmpe = mevRewards * (1 - mevCommission)
bidPmpe = max(0, bidCpmpe)
blockPmpe = blockRewards * (1 - blockRewardsCommission)
```

### On-chain vs Bond Obligation

**On-chain distributed**: What validators already pay via commissions (overrides apply).
**Bond obligation**: Additional PMPE from bonds (bid + commission overrides + commission diffs).

```typescript
onchainDistributedPmpe = onchainInflationPmpe + onchainMevPmpe
bondObligationPmpe = bidPmpe + blockPmpe + bondInflationDiff + bondMevDiff
```

Bond covers obligation, not on-chain commissions (those self-execute).

## Penalties

### Blacklist Penalty

Newly blacklisted validator (`samBlacklisted && !lastSamBlacklisted`) gets penalty:

```typescript
blacklistPenalty = winningPmpe + min(3 * effParticipatingBidPmpe, winningPmpe)
```

Makes bid 2-4x uncompetitive but not infinite (allows un-blacklisting recovery).

### Bid Too Low Penalty

Underbidding winning PMPE incurs penalty based on historical bids. Encourages competitive bidding.

## Key Files

- `packages/ds-sam-sdk/src/auction.ts`: `Auction.distributeSamStake()` main algorithm
- `packages/ds-sam-sdk/src/constraints.ts`: `AuctionConstraints` cap calculations
- `packages/ds-sam-sdk/src/calculations.ts`: PMPE and revenue share calculations
- `packages/ds-sam-sdk/src/config.ts`: Configuration defaults
- `packages/ds-sam-sdk/src/sdk.ts`: `DsSamSDK` entry point
- `src/commands/auction.cmd.ts`: CLI command implementation
- `src/commands/analyze-revenue.cmd.ts`: Revenue analysis command

## Data Provider

`packages/ds-sam-sdk/src/data-provider/`:

- Fetches validator info, bonds, TVL, blacklist, scoring from APIs
- Caches to local files for replay (`--cache-inputs --cache-dir-path`)
- `inputsSource`: `APIS` (live fetch) or `FILES` (cached replay)

## Testing

- `packages/ds-sam-sdk/test/`: SDK unit tests
- `test/`: CLI integration tests
- `make test`: Fast unit tests
- `make smoke`: Full test suite

## Helper Scripts

- `simulate-auction`: Run auction for specific epoch from GCP snapshots
- `evaluate-blacklist`: Test blacklist impact
- `evaluate-tag`: Evaluate tagged validator groups
