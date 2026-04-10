// Minimal structured logger for UniDisk.
// Uses console in environments without a proper logger available, and can be
// swapped for a winston instance or similar by replacing the default export.

export interface Logger {
  info(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  verbose(message: string, ...args: unknown[]): void
}

const consoleLogger: Logger = {
  info:    (msg, ...args) => console.log(`[INFO]  ${msg}`, ...args),
  error:   (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  verbose: (msg, ...args) => {
    if (process.env.UD_VERBOSE) console.log(`[VERB]  ${msg}`, ...args)
  },
}

export const logger: Logger = consoleLogger
