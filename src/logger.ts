/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

import * as log4js from 'log4js'

import type { LoggerService } from '@nestjs/common'

const InternalLoggerFactory = () => {
  log4js.configure({
    appenders: {
      app: {
        type: 'stdout',
        layout: {
          type: 'pattern',
          pattern: '%d %[[%p]%] %x{singleLine}',
          tokens: {
            singleLine: (logEvent: log4js.LoggingEvent) => {
              const [msg, ctx] = logEvent.data
              const err = ctx?.err
              if (err) {
                ctx.err = undefined
              }

              const ctxSerialized = ctx ? ` ${JSON.stringify(ctx)}` : ''
              const errSerialized = err instanceof Error ? ` <${err.name}: ${err.message}> (${err.stack})` : ''

              return `${msg}${errSerialized}${ctxSerialized}`.replace(/\n/g, '\\n')
            },
          },
        },
      },
    },
    categories: {
      default: { appenders: ['app'], level: 'DEBUG' },
    },
  })
  return log4js.getLogger()
}

export class Logger implements LoggerService {
  private readonly logger = InternalLoggerFactory()

  log(...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.logger.log('INFO', ...args)
  }
  error(...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.logger.log('ERROR', ...args)
  }
  warn(...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.logger.log('WARN', ...args)
  }
  debug(...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.logger.log('DEBUG', ...args)
  }
}
