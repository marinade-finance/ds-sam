import { Module } from '@nestjs/common'
import { CliService } from './cli.service'
import { Logger } from './logger'
import { AuctionCommand } from './commands/auction.cmd'
import { ConfigModule } from './config/config.module'
import { CliUtilityService } from 'nest-commander'
import { AnalyzeRevenuesCommand } from './commands/analyze-revenue.cmd'

@Module({
  imports: [
    ConfigModule,
    Logger,
  ],
  providers: [CliUtilityService, CliService, AuctionCommand, AnalyzeRevenuesCommand],
})
export class CliModule {}
