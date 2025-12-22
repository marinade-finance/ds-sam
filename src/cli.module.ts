import { Module } from '@nestjs/common'
import { CliUtilityService } from 'nest-commander'

import { CliService } from './cli.service'
import { AnalyzeRevenuesCommand } from './commands/analyze-revenue.cmd'
import { AuctionCommand } from './commands/auction.cmd'
import { ConfigModule } from './config/config.module'
import { Logger } from './logger'

@Module({
  imports: [ConfigModule, Logger],
  providers: [CliUtilityService, CliService, AuctionCommand, AnalyzeRevenuesCommand],
})
export class CliModule {}
