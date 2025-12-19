import { Injectable } from '@nestjs/common'
import * as dotenv from 'dotenv'
import { Logger } from 'logger'

dotenv.config()

@Injectable()
export class ConfigService {
  private readonly logger = new Logger()

  private getEnvVar(key: string, defaultVal?: string): string {
    const val = process.env[key] ?? defaultVal
    if (!val) {
      this.logger.error(`Missing environment variable: ${key}`)
      throw new Error(`Missing environment variable: ${key}`)
    }
    return val
  }

  readonly dummy = this.getEnvVar('', '[dummy]')
}
