import Decimal from "decimal.js"
import { RawBondDto, RawEpochStatDto, RawMndeVoteDto, RawValidatorDto, RawValidatorMevInfoDto } from "src"

const infiniteGenerator = function* (prefix: string, padding: number) {
    for (let i = 0; ; i++) {
        yield `${prefix}${i.toString().padStart(padding, '0')}`
    }
}
export const generateVoteAccounts = (label = '') => infiniteGenerator(`vote-acc-${label}-`, 10)
export const generateIdentities = () => infiniteGenerator('identity-', 10)

export class ValidatorMockBuilder {
    private inflationCommission: number = 0
    private mevCommission: number | null = null
    private isBlacklisted = false
    private mndeVotes: number | null = null
    private credits: number[] = []
    private nativeStake: number = 0
    private liquidStake: number = 0
    private externalStake: number = 0
    private version = '1.18.15'
    private bond: { stakeWanted: number, cpmpe: number, balance: number } | null = null

    constructor(public readonly voteAccount: string, public readonly identity: string,) { }

    withInflationCommission(commission: number) {
        this.inflationCommission = commission
        return this
    }

    withMevCommission(commission: number) {
        this.mevCommission = commission
        return this
    }

    withMndeVotes(votes: number) {
        this.mndeVotes = votes
        return this
    }

    withNativeStake(stake: number) {
        this.nativeStake = stake
        return this
    }

    withLiquidStake(stake: number) {
        this.liquidStake = stake
        return this
    }

    withExternalStake(stake: number) {
        this.externalStake = stake
        return this
    }

    withCredits(...credits: number[]) {
        this.credits = credits
        return this
    }

    withGoodPerformance() {
        return this.withCredits(...Array.from({ length: 10 }, () => 432000 - Math.round(Math.random() * 10000)))
    }

    withBadPerformance() {
        return this.withCredits(...Array.from({ length: 10 }, () => Math.round(Math.random() * 10000)))
    }

    blacklisted() {
        this.isBlacklisted = true
        return this
    }

    withBond(bond: { stakeWanted: number, cpmpe: number, balance: number }) {
        this.bond = bond
        return this
    }

    toRawBondDto(currentEpoch: number): RawBondDto | null {
        const { bond } = this
        if(!bond) {
            return null
        }

        const { balance, cpmpe, stakeWanted } = bond
        return {
            pubkey: '@todo some bond account',
            vote_account: this.voteAccount,
            authority: this.voteAccount,
            cpmpe: new Decimal(cpmpe).mul(1e9).toString(),
            funded_amount: new Decimal(balance).mul(1e9).toString(),
            effective_amount: new Decimal(balance).mul(1e9).toString(),
            remaining_witdraw_request_amount: "0",
            remainining_settlement_claim_amount: "0",
            updated_at: "some date",
            epoch: currentEpoch,
            max_stake_wanted: new Decimal(stakeWanted).mul(1e9).toString(),
        }
    }

    toRawBlacklistResponseDtoRow(): string | null {
        return this.isBlacklisted ? `${this.voteAccount},DUMMY_REASON` : null
    }

    toRawMndeVoteDto(): RawMndeVoteDto | null {
        const { mndeVotes } = this
        return mndeVotes === null ? null : {
            amount: mndeVotes.toString(),
            tokenOwner: 'some voter',
            validatorVoteAccount: this.voteAccount,
        }
    }

    toRawValidatorMevInfoDto(): RawValidatorMevInfoDto | null {
        const { mevCommission } = this
        return mevCommission === null ? null : {
            vote_account: this.voteAccount,
            mev_commission_bps: mevCommission * 100,
            mev_rewards: 0, // @todo
            running_jito: true,
            active_stake: 0, // @todo
        }
    }

    toRawValidatorDto(currentEpoch: number): RawValidatorDto {
        const inflationCommission = this.inflationCommission
        return {
            identity: this.identity,
            vote_account: this.voteAccount,
            activated_stake: new Decimal(this.nativeStake + this.liquidStake + this.externalStake).mul(1e9).toString(),
            marinade_stake: new Decimal(this.liquidStake).mul(1e9).toString(),
            marinade_native_stake: new Decimal(this.nativeStake).mul(1e9).toString(),
            dc_country: "CZ" + Math.random().toString(),
            dc_asn: 1000 + Math.random(),
            dc_aso: "AWS" + Math.random().toString(),
            version: this.version,
            commission_effective: inflationCommission,
            commission_advertised: inflationCommission,
            credits: this.credits[0] ?? 0,
            epoch_stats: this.credits.map((credits, e) => ({
                epoch: currentEpoch - e,
                activated_stake: new Decimal(this.nativeStake + this.liquidStake + this.externalStake).mul(1e9).toString(),
                marinade_stake: new Decimal(this.liquidStake).mul(1e9).toString(),
                marinade_native_stake: new Decimal(this.nativeStake).mul(1e9).toString(),
                version: this.version,
                commission_advertised: inflationCommission,
                credits: credits,
                epoch_end_at: "TODO",
            })),
        }
    }
}