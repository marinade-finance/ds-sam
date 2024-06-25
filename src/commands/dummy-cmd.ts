import { Command, CommandRunner } from 'nest-commander'
import { Logger } from '@nestjs/common'
import { DsSamSDK, InputsSource } from '@marinade.finance/ds-sam-sdk'

@Command({
  name: 'dummy',
  description: 'TODO',
})
export class DummyCommand extends CommandRunner {
  private readonly logger = new Logger()

  constructor () {
    super()
  }

  async run (): Promise<void> {
    this.logger.log('Running "dummy" command...')
    const dsSam = new DsSamSDK({ inputsCacheDirPath: 'data', inputsSource: InputsSource.FILES })
    // const dsSam = new DsSamSDK({ inputsCacheDirPath: 'data', inputsSource: InputsSource.APIS, cacheInputs: true })
    const result = await dsSam.run()
    this.logger.log('Finished "dummy" command')

    for (const validator of result.auctionData.validators) {
      console.log(`${validator.voteAccount}\t${validator.auctionStake.marinadeMndeTargetSol}\t${validator.auctionStake.marinadeSamTargetSol}\t${validator.revShare.totalPmpe}`)
    }
  }
}
