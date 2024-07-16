import { Module } from '@nestjs/common'
import { CliService } from './cli.service'
import { Logger } from './logger'
import { AuctionCommand } from './commands/auction.cmd'
import { ConfigModule } from './config/config.module'
import { CliUtilityService } from 'nest-commander'

@Module({
  imports: [
    ConfigModule,
    Logger,
  ],
  providers: [CliUtilityService, CliService, AuctionCommand],
})
export class CliModule {}
