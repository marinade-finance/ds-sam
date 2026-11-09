import { CommandFactory } from 'nest-commander'

import { CliModule } from './cli.module'
import { Logger } from './logger'

async function bootstrap() {
  await CommandFactory.run(CliModule, {
    logger: new Logger(),
    serviceErrorHandler: err => {
      process.stderr.write(`${err.toString()}\n`)
      process.exitCode = 1
    },
  })
}

void bootstrap()
