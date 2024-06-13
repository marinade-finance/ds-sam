import { Command, CommandRunner } from 'nest-commander'
import { Logger } from '@nestjs/common'
import { DsSamSDK } from '@marinade.finance/ds-sam-sdk'

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
    const dsSam = new DsSamSDK({ inputsCacheDirPath: 'data' })
    const result = await dsSam.dummy()
    this.logger.log('Finished "dummy" command', { result })
  }
}
