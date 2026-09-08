import fs from 'fs'
import path from 'path'

import { InputsSource, LogVerbosity } from '@marinade.finance/ds-sam-calc'

import { DsSamSDK } from '../src/sdk'

import type { DsSamConfig } from '@marinade.finance/ds-sam-calc'

// Every value that a commission feeds, directly or through the clearing price. Drift in any of them
// moves real SOL: the first four decide who wins, the rest decide what is charged from the bond.
const REPLAY_KEYS = [
  'totalPmpe',
  'inflationPmpe',
  'mevPmpe',
  'blockPmpe',
  'bidPmpe',
  'onchainDistributedPmpe',
  'bondObligationPmpe',
  'auctionEffectiveBidPmpe',
  'auctionEffectiveStaticBidPmpe',
  'effParticipatingBidPmpe',
  'expectedMaxEffBidPmpe',
  'bidTooLowPenaltyPmpe',
] as const

const REPLAY_EPOCHS = 3

type StoredValidator = {
  voteAccount: string
  revShare: Record<string, number>
  auctionStake: { marinadeSamTargetSol: number }
  values: { commissions: { inflationCommissionOnchainDec: number | null } }
}

type StoredResults = {
  winningTotalPmpe: number
  auctionData: { validators: StoredValidator[] }
}

const auctionsDirPath =
  process.env.DS_SAM_AUCTIONS_DIR ?? path.join(__dirname, '..', '..', '..', '..', 'ds-sam-pipeline', 'auctions')

const readStoredResults = (archivePath: string): StoredResults =>
  JSON.parse(fs.readFileSync(path.join(archivePath, 'outputs', 'results.json')).toString()) as StoredResults

const listArchives = (): string[] => {
  if (!fs.existsSync(auctionsDirPath)) {
    return []
  }
  return fs
    .readdirSync(auctionsDirPath)
    .filter(name => /^\d+\.\d+$/.test(name))
    .filter(name => fs.existsSync(path.join(auctionsDirPath, name, 'outputs', 'results.json')))
    .sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]))
    .slice(-REPLAY_EPOCHS)
    .map(name => path.join(auctionsDirPath, name))
}

const archives = listArchives()

// The archives are a sibling checkout of marinade-finance/ds-sam-pipeline, not part of this repo.
const describeWithArchives = archives.length > 0 ? describe : describe.skip
if (archives.length === 0) {
  console.warn(
    `No ds-sam-pipeline auction archives at ${auctionsDirPath}, replay skipped. ` +
      'Clone marinade-finance/ds-sam-pipeline next to this repo or set DS_SAM_AUCTIONS_DIR.',
  )
}

describeWithArchives('replay of archived auctions', () => {
  it.each(archives)('reproduces %s exactly', async archivePath => {
    const fileConfig = JSON.parse(
      fs.readFileSync(path.join(archivePath, 'inputs', 'config.json')).toString(),
    ) as Partial<DsSamConfig>
    const sdk = new DsSamSDK({
      ...fileConfig,
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: path.join(archivePath, 'inputs'),
      logVerbosity: LogVerbosity.ERROR,
    })

    const result = await sdk.run()
    const stored = readStoredResults(archivePath)
    const storedByVoteAccount = new Map(stored.auctionData.validators.map(v => [v.voteAccount, v]))

    const diffs: string[] = []
    for (const validator of result.auctionData.validators) {
      const storedValidator = storedByVoteAccount.get(validator.voteAccount)
      if (!storedValidator) {
        diffs.push(`${validator.voteAccount} not present in the archive`)
        continue
      }
      const replayed = validator.revShare as unknown as Record<string, number>
      for (const key of REPLAY_KEYS) {
        if (replayed[key] !== storedValidator.revShare[key]) {
          diffs.push(
            `${validator.voteAccount} ${key}: replay=${replayed[key]} archive=${storedValidator.revShare[key]}`,
          )
        }
      }
      if (validator.auctionStake.marinadeSamTargetSol !== storedValidator.auctionStake.marinadeSamTargetSol) {
        diffs.push(
          `${validator.voteAccount} marinadeSamTargetSol: replay=${validator.auctionStake.marinadeSamTargetSol} archive=${storedValidator.auctionStake.marinadeSamTargetSol}`,
        )
      }
    }

    expect(diffs).toEqual([])
    expect(result.auctionData.validators.length).toEqual(stored.auctionData.validators.length)
    expect(result.winningTotalPmpe).toEqual(stored.winningTotalPmpe)
  })

  it('replays epochs that actually differ in on-chain inflation commission', () => {
    const onchainByEpoch = archives.map(
      archivePath =>
        new Map(
          readStoredResults(archivePath).auctionData.validators.map(v => [
            v.voteAccount,
            v.values.commissions.inflationCommissionOnchainDec,
          ]),
        ),
    )
    const [first, ...rest] = onchainByEpoch
    expect(first).toBeDefined()
    const changed = rest.some(later =>
      [...later].some(([voteAccount, onchainDec]) => {
        const before = first?.get(voteAccount)
        return before !== undefined && before !== onchainDec
      }),
    )
    expect(changed).toBe(true)
  })
})
