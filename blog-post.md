# DS-SAM dynamic commission (a blogpost)

!!!NOTE!!!: resolve TODO before publishing

The Marinade DS SAM (Stake Auction Marketplace) made another step forward to easier management for validators
to participate. That consists of dynamic commission bidding. From here let's decipher what it consists of.

## DS SAM auction - basics and terminology

Let's start our journey with a general overview what the auction is about.

Let's start with some entry points. For the technical details you can check the documentation at https://docs.marinade.finance/marinade-protocol/protocol-overview/stake-auction-market and then we recommend to look at the CLI documentation https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli. The CLI is the only main entrance to configure parameters for the Marinade Max Yield DS SAM auction.
The data around the auction, participants and epoch results can be checked at the dashboard at https://psr.marinade.finance/

The idea of the auction is simple - deliver the best yield for stakers that authorized Marinade to manage their SOL to split it
amongst multiple Solana validators to support decentralization aspect of the whole web3 ecosystem. Marinade manages the funds
with responsibility a good treasurer and it asks (and expects) the validators to guarantee well managed systems without
downtimes, while with decentralization it strives to deliver the best yield on Solana for its stakers.

The approach Marinade utilizes is via tracking validators' performance and the auction system where validators may compete
for stake to be delegated to them. When validator wants to join the auction he needs to create a bond that is a pre-funded
"vault" that can be charged by Marinade as a bidding event and/or a penalty event (i.e., [PSR](https://docs.marinade.finance/marinade-protocol/protocol-overview/protected-staking-rewards)).
[The bond](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli#core-concepts)
is managed by an on-chain [validator bonds program](https://github.com/marinade-finance/validator-bonds/tree/main/programs/validator-bonds). All funded means are stored as stake accounts that are delegated to the validator vote account that the bond
belongs to. With that the funded SOL still generates the rewards for delegation to the validator himself.

The core of the auction is that validator may bid for getting the stake from Marinade stake pool.
By bidding it means offering more SOLs for stakers on top of what the staker normally gains for SOL staked to a validator
and his commission setup.
For validator, having bigger APY offered to stakers means more possible stake assigned from Marinade's pool.
So validator defines some commission - inflation and MEV - on-chain and on top of that the validator may configure
a bid in Marinade and offer more for Marinade stakers, see [SAM &mdash; how it works](https://marinade.finance/how-it-works/sam) at Marinade.finance site.

Marinade runs the auction calculation once at the start of each epoch. The charging of bonds for auction results and downtime
penalty events happen similarly at the start of the epoch but always for the range of the previous epoch. That means
when the auction is calculated at the epoch X then it is charged from bond at the epoch X+1.

### Marinade staking offering

As a short sidetravel we should say that Marinade works with 3 types of "pools" that stakers may use when letting Marinade
to manage their SOLs. One offering is the firstly released Liquid Staking pool on Solana. Here staker places his SOL under management of [Marinade Liquid Staking program](https://github.com/marinade-finance/liquid-staking-program)
and gains back an MSOL token that can be used in DeFi and that can be whenever exchanged back to SOL.
All staking rewards and earns from the bonds charging are put back into this liquid staking pool and progressively
increase the SOL price of the [MSOL token](https://docs.marinade.finance/marinade-protocol/protocol-overview/marinade-liquid/what-is-msol).
The other offering is native staking that works with core Solana
[staking delegation functionality](https://solana.com/docs/references/staking).
Any SOL that is staked with Marinade this way is transferred under a stake account owned by the original owner.
That way there is no possibility Marinade may withdraw or transfer the SOL from the original owner.
There is no danger connected with transferring the SOL under ownership of an on-chain pool program
(as it is for any liquid staking program).
The user only lends "a delegate authority" of the stake account under Marinade management.
Any additional rewards gained by charging bonds are claimed automatically under users' stake account
and thus increasing the SOL amount owned by the owner every epoch.
The third option is a select program that staker may use when he wants to stake only with a KYCed certified validators.
From technical perspective the select program works the same way as described above for native staking.
Separate option is the Marinade Recipes that provides a way you gain rewards in different tokens than only as SOL.

Only(**!**) SOLs that are staked with the liquid staking solution and native staking are part of the DS SAM auction,
see at [max yield product](https://marinade.finance/native-staking/marinade-max-yield).
Funding under [select program](https://marinade.finance/native-staking/marinade-select) and [recipes](https://marinade.finance/features/marinade-recipes) is managed a different way.

The stake managed by Marinade, split by these offerings, can be checked at [stas.marinade.finance](http://stas.marinade.finance).

## Configuring the auction

The entry point for creating the bond, funding it and configuring the auction is [validator bonds CLI](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli).

Validator needs to install it as described at [the CLI installation guide](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli#prerequisites--installation)
and then process with funding.

And now, the validator may configure the following parameters to be considered for the auction processing.

### On-chain commission configuration

Validator setups its inflation commission in the standard [validator's operational way](https://docs.anza.xyz/operations/guides/vote-accounts#commission).
The same with the MEV commission when running the
[MEV capable validator program instance](https://jito-foundation.gitbook.io/mev/jito-solana/command-line-arguments).

This defines the baseline on how many SOL is shared from validators to stakers and defines the base APY that the validator
earns for the stakers.

### Validator Bonds CLI configuration

Until the dynamic commission configuration was introduced the validators may configure auction parameters only with
`max stake wanted` and `static bid CPMPE` parameters. From now, they can vary between "static bidding" with `CPMPE`
parameter and dynamic commission by setting up the commission with
[CLI parameter to influence the commission shared](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli#bond-management)
only from Marinade assigned stake. All the bonds configuration parameters are charged
from the validator's funded bond account.

What are the particular configuration parameters.

First parameter of the bond configuration is the amount of SOL funded. The validator is required to have funded bond
enough that the auction permits to assing the stake. When the bond is not funded enough no new stake is delegated
and Marinade may start undelegating. The expectation of the SOLs funded in the bond changes based on the auction results
as the auction calculates for the validator to have bond funded to cover the spends of the auction winner
for the [next 12 epochs](https://github.com/marinade-finance/ds-sam-pipeline/blob/a4968e215d7a0249ee4b5af1e8253bbd6f3558a0/auction-config.json#L40). The safe starting point is to fund Bond of 1 SOL for every 2000 SOLs wanted to be delegated from Marinade.
(TODO: check with Cerba if it is good recommendation)

Next configuration is `max-stake-wanted`. Here could be a little misunderstanding what this parameter sets up.
It sets the maximum total stake this validator wants to receive through the auction.
This parameter only prevents the validator from receiving additional stake beyond the specified limit.
It does **not** reduce or remove stake that has already been delegated.
To reduce your current stake the validator must un-fund the bond to exit the auction.
After exiting, you can rejoin with a lower `max-stake-wanted` value if desired.

The bidding parameters are `cpmpe` that is an abbreviation to "cost per mille per epoch" and we refer to this parameter
as static bidding configuration. This way validator configures how many lamports he wants to pay for a 1000 SOL delegated
from Marinade pool as the yield shared to stakers.

On top of it, validator may consider to use commission configuration (as we name it dynamic commission bidding)
where they set lower commission than their on-chain commission setup.
With that they are going to share bigger APY from commission with stakers from Marinade stake only
that will be charged as the settlement from their bond.
With this the validator may configure not only the inflation and MEV commission but block rewards commission as well.
That option is currently not available natively on Solana, until probably the
[SIMD-0123](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0123-block-revenue-distribution.md) is finalized.

The configuration options are `inflation-commission <bps>`, `mev-commisson <bps>` and `block-commission <bps>`.
The commission specifies the portion of particular commission rewards the validator keeps.
The remainder is shared with stakers through bond claims, as said.
The commission value can be negative (max 100%/10,000 bps), where the validator declares to pay more
than what is gained in rewards in the epoch.

## Another more details on auction stake delegation

On top of the APY importance the stake shared is influenced by other Marinade internal configuration parameters.
The configuration is stored in the [ds-sam-pipeline](https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json)
repository and defines for example what is maximal share of the whole Marinade max yield TVL with a single validator (see `maxMarinadeTvlSharePerValidatorDec`) - which is currently `4%` and will be redefined to `15%` after implementation of
[MIP-19](https://forum.marinade.finance/t/mip-19-improving-sam-auction-stake-priority-bond-risk-reduction-mechanism-higher-validator-caps/1969).
MIP-19 brings additional improvements including auction stake priority based on bids, bond risk reduction mechanism with penalties for insufficient bond coverage, and removal of the underutilized MNDE Enhanced Stake feature.
Other configuration parameters support decentralization (i.e., `maxMarinadeStakeConcentrationPer...`) that help to share the stake
over more countries, datacenters and other these kind of parameter axes.

Another limitation that Marinade faces with stake delegation is the Solana delegation process.
Any unstaking of the any stake account from one validator to other takes 2 epoch.
First the stake needs to be marked as ["deactivating"](https://github.com/solana-program/stake/blob/393baa6336769ef9894417959e4d974bd079e512/interface/src/stake_history.rs#L17).
For this epoch validator still gains the inflation rewards as validator still votes with the weight of that stake amount.
At the start of the next epoch the stake is `deactivated` and can be immediately (or whenever during this or next epochs)
got delegated to another validator in state `activating`. The `deactivated` and `activating` stake gains no rewards
as validator has not got its weight for voting
in the [Solana consensus processing](https://solana.com/developers/evm-to-svm/consensus#solanas-consensus).
Only at the start of the next epoch (i.e., X+2 after deactivation) the stake is fully activated under the new validator.

Because of this the rebalance to a new validator is not only slow but costly, and Marinade tries to rebalance as little as possible.
Marinade defines a cap for the amount of stake that can be unstaked (moved into `deactivating`) in one particular epoch.
The cap is a Marinade internal datapoint defined as a percentage of whole TVL per epoch
(TODO: the configuration is within a private repository, can we share that is about 2%? It seems to be 1.4% per epoch for native, probably? https://github.com/marinade-finance/ops-infra/blob/master/argocd/ns-env/schedule.prod.yaml and 0.7% per epoch for liquid? https://github.com/marinade-finance/marcrank/blob/main/src/commands/partial_unstake.rs#L45-L46, i.e., 2.1% together, this should be verified in case we want to share the info).

With that, a validator may be considered as being out of the auction after the auction epoch calculation
but it is not immediately undelegated. As the per epoch undelegation amount is capped
the validator that gained SOLs and is still behaving properly can be still with delegated SOLs (`SAM Active`) for several epochs
despite the auction `SAM Target` - the number of SOLs that the auction wants to delegate to validator -
was decreased to 0 SOLs.

The process of charging SOLs from bonds is a separate process that does not care about auction delegation decisions
but it cares what is the validator's bidding setup and what was the amount of Marinade stake the validator operates in particular epoch.
From that the bonds are charged and the results of the bond charging can be followed
at the [Marinade Discord](https://docs.marinade.finance/official-links) at channel `#psr-feed`.
Settlements created from bond charges remain claimable for approximately 4 epochs; any unclaimed funds return to the bond.

## Auction calculation

The auction works on calculation of "last price auction". Marinade lines up validators by their yield potential and distributes
stake accordingly. The "realized yield" gets set to the lowest yield in that list (the last validator picked).
This number is referrenced as effective bid as it defines the real number of SOLs charged from the bond for 1000 SOL staked.
Validators with better yields don't get paid their full asking price—they get paid at this lower realized yield instead.

How they actually get charged depends on how they bid:

- **Static bids (CPMPE)**: Marinade charges based on the realized yield and stake amount. Since the yield is lower than what they asked for, the charge is often smaller too—unless they're the last validator on the list.
- **Dynamic commission bids**: Marinade looks at what the validator actually earned and charges a commission based on real performance. If a validator has 5% commission on-chain but agreed to 3% in their bond, stakers get back an extra 2%. Marinade charges that 2% difference from the validator's bond.

Validators don't overpay with static bids, and rewards stay transparent with dynamic ones.
Both payment styles work side-by-side based on how each validator chose to bid.

## Technical details on auction processing

The code of the auction calculations is public and can be reviewed at the github repository [ds-sam](https://github.com/marinade-finance/ds-sam).
The every epoch processing is evaluated via github actions at repository `[ds-sam-pipelines](https://github.com/marinade-finance/ds-sam-pipeline).
That is place where you can see under the folder
[`/auctions`](https://github.com/marinade-finance/ds-sam-pipeline/tree/main/auctions/910.35819)
results (see `auctions/<epoch>/outputs/results.json`) of the auction with all datapoints for particular validator.

The code of the on-chain validator bonds program and the pipeline processing is at github repository
[validator-bonds](https://github.com/marinade-finance/validator-bonds).
The pipeline process is not public but the results can be recalculated and verified
(see [settlement distribution info](https://github.com/marinade-finance/validator-bonds/tree/main/settlement-distributions/bid-distribution)) and the results of the calculations are available
at the [google cloud storage](https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet).

## Final hints on dynamic bidding in auction

The starting point to see what is the current auction state is the dashboard [psr.marinade.finance](https://psr.marinade.finance).
The static bid is clear as offering of the number of SOLs (note: CLI works with lamports) per 1000 staked SOL.
For dynamic commission the payout in SOLs varies not directly on staked SOL amount but depends on the validator's ability
to harvest MEV and block priority rewards. The auction recalculates the SOL gains to bid

- i.e., how much 1 staked SOL earned SOLs from rewards - and the sum of dynamic commission gains and static bidding gains
  are combined into the final number of validator's offering to pay out for 1000 SOL staked. This is the number that is used
  for the auction to calculate the winner, while the real charge is the effective bid and comes with the last price auction method, see description above.

The dashboard's `Run Simulation` feature can help here where you can test different bid setups for a particular validator and see how the auction is recalculated.

With that said, there is no direct recommendation how to set the auction for the validator.
This is up to the validator what mix of the dynamic bidding and static bid is used in way what is convenient in his strategy.

## Summary

The Marinade DS SAM dynamic commission feature gives validators a new way to bid for stake in the auction. Instead of only offering a fixed static bid (CPMPE - cost per mille per epoch), validators can now configure lower commission rates specifically for Marinade-delegated stake. This means they can share a bigger portion of their inflation, MEV, and even block rewards with stakers, while keeping their on-chain commission settings as they are for other delegations.

Here's what matters for validators joining or participating in the auction:

**Configuration basics**: Validators need to create and fund a bond account using the validator bonds CLI. The bond acts as a pre-funded vault that Marinade charges based on your auction bids and delegation amount. Safe starting point is 1 SOL in the bond for every 2000 SOL you want delegated from Marinade.

**Bidding options**: You can use static bidding (CPMPE - paying fixed lamports per 1000 SOL per epoch), dynamic commission (setting lower commission rates than your on-chain setup), or mix both approaches. Dynamic commission works with inflation, MEV, and block rewards. Commission values can even go negative if you want to pay extra from your bond.

**How the auction works**: Marinade uses a "last price auction" model. Validators are lined up by their yield potential, and stake gets distributed accordingly. The "effective bid" - the actual charge - is set to the lowest yield from validators who got stake (the last one picked). If you bid higher, you don't pay your full asking price; you pay this lower realized yield instead.

**Important limits**: The `max-stake-wanted` parameter sets a ceiling on how much stake you can receive but does **not** reduce stake you already have. To leave the auction or reduce your stake, you need to un-fund your bond. Marinade also has caps on per-validator TVL share (currently 4%, planned to increase to 15% with MIP-19) and limits on how much stake can be undelegated per epoch to minimize the cost of moving stake around.

**Where to track**: Watch the auction results at [psr.marinade.finance](https://psr.marinade.finance) and bond charging events in the Marinade Discord #psr-feed channel.

The choice between static and dynamic bidding depends on your strategy. There's no single right answer - it's about what fits your validator operation and risk tolerance.
