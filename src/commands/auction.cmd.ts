import { Command, CommandRunner } from 'nest-commander'
import { Logger } from '@nestjs/common'
import { DsSamSDK, InputsSource } from '@marinade.finance/ds-sam-sdk'

const COMMAND_NAME = 'auction'

@Command({
  name: COMMAND_NAME,
  description: 'Run the auction with default config', // TODO add external config support
})
export class AuctionCommand extends CommandRunner {
  private readonly logger = new Logger()

  constructor () {
    super()
  }

  async run (): Promise<void> {
    this.logger.log(`Running "${COMMAND_NAME}" command...`)
    const dsSam = new DsSamSDK({ inputsCacheDirPath: 'data', inputsSource: InputsSource.FILES, debugVoteAccounts: [] })
    // const dsSam = new DsSamSDK({ inputsCacheDirPath: 'data', inputsSource: InputsSource.APIS, cacheInputs: true })
    const result = await dsSam.run()
    this.logger.log(`Finished "${COMMAND_NAME}" command`)

    for (const validator of result.auctionData.validators) {
      const lastCapConstraint = validator.lastCapConstraint ? `${validator.lastCapConstraint.constraintType} (${validator.lastCapConstraint.constraintName})` : 'NULL'
      console.log(`${validator.voteAccount}  \t${validator.auctionStake.marinadeMndeTargetSol}\t${validator.auctionStake.marinadeSamTargetSol}\t${validator.revShare.totalPmpe}\t${lastCapConstraint}`)
    }
  }
}
