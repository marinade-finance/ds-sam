import { Module } from '@nestjs/common'
import { CliService } from './cli.service'
import { Logger } from './logger'
import { DummyCommand } from './commands/dummy-cmd'
import { ConfigModule } from './config/config.module'

@Module({
  imports: [
    ConfigModule,
    Logger,
  ],
  providers: [CliService, DummyCommand],
})
export class CliModule {}
