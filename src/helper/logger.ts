// Minimal structured logger for UniDisk.
// Uses console in environments without a proper logger available, and can be
// swapped for a winston instance or similar by replacing the default export.

export interface Logger {
  info(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  verbose(message: string, ...args: unknown[]): void
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const offsetMins  = -now.getTimezoneOffset()
  const sign        = offsetMins >= 0 ? '+' : '-'
  const absHours    = Math.floor(Math.abs(offsetMins) / 60)
  const absMins     = Math.abs(offsetMins) % 60
  const tz          = absMins > 0
    ? `GMT${sign}${absHours}:${pad(absMins)}`
    : `GMT${sign}${absHours}`
  return `${date} ${time} (${tz})`
}

const consoleLogger: Logger = {
  info:    (msg, ...args) => console.log(`[${timestamp()}] [INFO]  ${msg}`, ...args),
  error:   (msg, ...args) => console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args),
  verbose: (msg, ...args) => {
    if (process.env.UD_VERBOSE) console.log(`[${timestamp()}] [VERB]  ${msg}`, ...args)
  },
}

export const logger: Logger = consoleLogger
