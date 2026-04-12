#!/usr/bin/env node
/**
 * udFuse — mounts a UniDisk cloud-storage provider as a local FUSE filesystem.
 *
 * Usage:
 *   npx tsx src/udFuse.ts [options] <mountPoint>
 *
 * Options:
 *   -d              Enable FUSE debug output.
 *   -m <module>     Provider module name (e.g. Sample, Dropbox, TeraBox).
 *   -p <profile>    Profile name from ~/.unidisk/settings.json.
 *   -w              Enable write support.
 *
 * Example:
 *   npx tsx src/udFuse.ts -m Sample /tmp/mnt
 *   npx tsx src/udFuse.ts -p myDropbox -w /tmp/mnt
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import Fuse from 'fuse-native'
import { UdManager } from './helper/udManager'
import { Settings } from './helper/Settings'
import { logger } from './helper/logger'
import type { StorageProvider, ProviderProfile } from './types'

const IS_OSX = os.platform() === 'darwin'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface MountOptions {
  mountPoint: string
  module: string
  profileName?: string
  profile: ProviderProfile
  writable: boolean
  debug: boolean
  configPath?: string  // resolved path to the file used for Settings.load()
}

function parseArgs(): MountOptions | null {
  const args = process.argv.slice(2)
  if (args.length === 0) return null

  const mountPoint = args.pop()!
  const opts: Partial<MountOptions> & { writable: boolean; debug: boolean } = {
    writable: false,
    debug: false,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-d') {
      opts.debug = true
    } else if (args[i] === '-v') {
      process.env.UD_VERBOSE = '1'
    } else if (args[i] === '-w') {
      opts.writable = true
    } else if (args[i] === '-m') {
      opts.module = args[++i]
    } else if (args[i] === '-p') {
      opts.profileName = args[++i]
    } else {
      console.error(`Unknown option: ${args[i]}`)
      return null
    }
  }

  opts.mountPoint = mountPoint

  if (opts.profileName) {
    const p = opts.profileName
    const isFilePath = p.endsWith('.json') || p.includes('/') || p.includes('\\')
    if (isFilePath) {
      // Load profile directly from a JSON file.
      // Also record the path so main() loads global settings (block_reading_size,
      // queue_concurrency, etc.) from the same file rather than from
      // ~/.unidisk/settings.json which may not have those keys.
      const resolvedPath = path.resolve(p)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const profile = require(resolvedPath) as ProviderProfile
      opts.profile    = profile
      opts.module     = opts.module ?? (profile as { module?: string }).module
      opts.writable   = opts.writable || !!(profile as { writable?: boolean }).writable
      opts.configPath = resolvedPath
    } else {
      // Look up a named profile from ~/.unidisk/settings.json
      Settings.load()
      const profile = Settings.getProfile(p)
      opts.profile  = profile
      opts.module   = opts.module ?? profile.module
      opts.writable = opts.writable || !!profile.writable
    }
  }

  if (!opts.module) {
    console.error('Error: specify a provider with -m <module> or -p <profile>')
    return null
  }

  if (!opts.profile) {
    opts.profile = { cacheStore: 'memory' }
  }

  return opts as MountOptions
}

function usage(): void {
  console.log(
    'Usage: unidisk [options] <mountPoint>\n' +
    '\n' +
    'Options:\n' +
    '  -d              Enable FUSE debug output.\n' +
    '  -v              Enable verbose logging.\n' +
    '  -m <module>     Provider module name (e.g. Sample, Dropbox, TeraBox).\n' +
    '  -p <profile>    Path to a profile JSON file, or a profile name from\n' +
    '                  ~/.unidisk/settings.json.\n' +
    '  -w              Enable write support.\n' +
    '\n' +
    'Examples:\n' +
    '  unidisk -m Sample -p profile.json /tmp/mnt\n' +
    '  unidisk -p MyTeraBox /tmp/terabox\n' +
    '  unidisk -p MyDropbox -w /tmp/dropbox\n'
  )
}

// ---------------------------------------------------------------------------
// Provider loader
// ---------------------------------------------------------------------------

function loadProvider(moduleName: string, profile: ProviderProfile): StorageProvider {
  // Works for both `tsx src/udFuse.ts` (__dirname = src/) and compiled
  // `node dist/udFuse.js` (__dirname = dist/).
  const modulePath = path.resolve(__dirname, 'clouddrive', moduleName)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(modulePath) as Record<string, unknown>
  const ProviderClass = (mod[moduleName] ?? mod['default'] ?? mod) as new () => StorageProvider
  const provider = new ProviderClass()
  provider.init(profile)
  return provider
}

// ---------------------------------------------------------------------------
// FUSE handlers
// ---------------------------------------------------------------------------

type FuseHandlers = ConstructorParameters<typeof Fuse>[1]

export function buildHandlers(udm: UdManager, writable: boolean): FuseHandlers {
  const ENOENT = Fuse.ENOENT  // -2
  const EPERM  = Fuse.EPERM   // -1
  const EISDIR = Fuse.EISDIR  // -21
  const EIO    = Fuse.EIO     // -5

  function toFlag(flags: number): 'r' | 'w' | 'r+' {
    const f = flags & 3
    if (f === 0) return 'r'
    if (f === 1) return 'w'
    return 'r+'
  }

  const readHandlers: FuseHandlers = {

    getattr(filePath: string, cb: (code: number, stat?: object) => void) {
      udm.getFileMeta(filePath).then(meta => {
        if (!meta) return cb(ENOENT)
        const ts = {
          mtime: new Date(meta.mtime),
          atime: new Date(meta.mtime),
          ctime: new Date(meta.ctime),
          uid: process.getuid!(),
          gid: process.getgid!(),
          nlink: 1,
        }
        if (meta.isdir === 1) {
          cb(0, { ...ts, size: 4096, mode: 0o40770 })
        } else {
          cb(0, { ...ts, size: meta.size, mode: 0o100660 })
        }
      }).catch(() => cb(ENOENT))
    },

    readdir(filePath: string, cb: (code: number, names?: string[]) => void) {
      udm.getFileList(filePath)
        .then(list => cb(0, list.map(e => path.basename(e.path))))
        .catch(() => cb(ENOENT))
    },

    open(filePath: string, flags: number, cb: (code: number, fd?: number) => void) {
      const flag = toFlag(flags)
      udm.getFileMeta(filePath).then(async meta => {
        if (!meta) { cb(ENOENT); return }
        if (meta.isdir === 1) { cb(EISDIR); return }
        const fd = await udm.openFile(filePath, flag)
        cb(0, fd)
      }).catch(() => cb(EPERM))
    },

    // fuse-native read: the FIRST callback arg is the FUSE return value
    // (bytes read >= 0, or negative errno).  The second arg is unused by
    // the native layer — do NOT call cb(0, len).
    read(filePath: string, _fd: number, buf: Buffer, len: number, offset: number,
         cb: (bytesRead: number) => void) {
      udm.downloadFileInRangeByCache(filePath, buf, offset, len)
        .then(() => cb(len))
        .catch(() => cb(EIO))
    },

    release(filePath: string, fd: number, cb: (code: number) => void) {
      udm.closeFile(filePath, fd).then(() => cb(0)).catch(() => cb(EPERM))
    },

    statfs(_filePath: string, cb: (code: number, stat?: object) => void) {
      udm.showStat().then(({ data }) => {
        const bs = 4096
        cb(0, {
          bsize:   bs,
          blocks:  Math.floor(data.quota / bs),
          bfree:   Math.floor((data.quota - data.used) / bs),
          bavail:  Math.floor((data.quota - data.used) / bs),
          namemax: 1000,
        })
      }).catch(() => cb(EIO))
    },

    // ---- No-op stubs required by macOS / some Linux tools ----------------

    setxattr(filePath: string, _name: string, _value: Buffer,
             _pos: number, _flags: number, cb: (code: number) => void) {
      logger.verbose(`setxattr ${filePath} (no-op)`)
      cb(0)
    },

    flush(filePath: string, _fd: number, cb: (code: number) => void) {
      logger.verbose(`flush ${filePath}`)
      cb(0)
    },

    utimens(filePath: string, _atime: number, _mtime: number,
            cb: (code: number) => void) {
      logger.verbose(`utimens ${filePath} (no-op)`)
      cb(0)
    },

    chown(filePath: string, _uid: number, _gid: number,
          cb: (code: number) => void) {
      logger.verbose(`chown ${filePath} (no-op)`)
      cb(0)
    },

    chmod(filePath: string, _mode: number, cb: (code: number) => void) {
      logger.verbose(`chmod ${filePath} (no-op)`)
      cb(0)
    },
  }

  if (!writable) return readHandlers

  // ---- Write-mode additions ----------------------------------------------

  return {
    ...readHandlers,

    create(filePath: string, _mode: number, cb: (code: number, fd?: number) => void) {
      udm.createEmptyFile(filePath)
        .then(async () => {
          const fd = await udm.openFile(filePath, 'w')
          cb(0, fd)
        })
        .catch(() => cb(EPERM))
    },

    // Same first-arg-is-FUSE-return-value convention as read.
    write(filePath: string, fd: number, buf: Buffer, len: number, offset: number,
          cb: (bytesWritten: number) => void) {
      udm.write(filePath, fd, buf, offset, len)
        .then(n => cb(n))
        .catch(() => cb(EPERM))
    },

    unlink(filePath: string, cb: (code: number) => void) {
      udm.deleteFile(filePath).then(() => cb(0)).catch(() => cb(ENOENT))
    },

    rename(src: string, dst: string, cb: (code: number) => void) {
      udm.move(src, dst).then(() => cb(0)).catch(() => cb(ENOENT))
    },

    mkdir(filePath: string, _mode: number, cb: (code: number) => void) {
      udm.createFolder(filePath).then(() => cb(0)).catch(() => cb(ENOENT))
    },

    rmdir(filePath: string, cb: (code: number) => void) {
      udm.deleteFolder(filePath).then(() => cb(0)).catch(() => cb(ENOENT))
    },

    // Only truncate-to-zero is supported (used before overwriting a file).
    truncate(filePath: string, size: number, cb: (code: number) => void) {
      if (size !== 0) {
        logger.error(`truncate: rejecting non-zero size=${size} for ${filePath}`)
        cb(EPERM)
      } else {
        cb(0)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Mount / unmount
// ---------------------------------------------------------------------------

function mount(
  mountPoint: string,
  handlers: FuseHandlers,
  opts: object
): Promise<Fuse> {
  return new Promise((resolve, reject) => {
    const fuse = new Fuse(mountPoint, handlers, opts)
    fuse.mount((err: Error | null) => (err ? reject(err) : resolve(fuse)))
  })
}

function unmount(fuse: Fuse): Promise<void> {
  return new Promise((resolve, reject) => {
    fuse.unmount((err: Error | null) => (err ? reject(err) : resolve()))
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs()
  if (!opts) {
    usage()
    process.exit(1)
  }

  // Load global settings from the same file the profile came from.
  // For a named profile (-p MyDropbox) that is ~/.unidisk/settings.json.
  // For a file-path profile (-p /path/to/dropbox.json) that is the profile
  // file itself, which may contain block_reading_size, queue_concurrency, etc.
  Settings.load(opts.configPath)

  logger.info(`Loading provider: ${opts.module}`)
  const provider = loadProvider(opts.module, opts.profile)

  const blockSize          = Settings.get('block_reading_size')   ?? 1024 * 1024
  const blockWritingSize   = Settings.get('block_writing_size')   ?? 8 * 1024 * 1024
  const fuseIoSize         = Settings.get('fuse_iosize')          ?? 65536
  const queueConcurrency   = Settings.get('queue_concurrency')    ?? 1
  const prefetchBlocks     = Settings.get('prefetch_blocks')      ?? 2
  const maxDataCacheEntries = Settings.get('max_data_cache_entry') ?? 20

  const udm = new UdManager()
  udm.init({
    provider,
    profile: opts.profile,
    blockSize,
    blockWritingSize,
    fuseIoSize,
    queueConcurrency,
    prefetchBlocks,
    maxDataCacheEntries,
  })

  logger.info(`  block_reading_size   : ${blockSize} bytes (${blockSize / 1024 / 1024} MiB)`)
  logger.info(`  max_data_cache_entry : ${maxDataCacheEntries}`)
  logger.info(`  queue_concurrency    : ${queueConcurrency}`)
  logger.info(`  prefetch_blocks      : ${prefetchBlocks}`)

  const handlers = buildHandlers(udm, opts.writable)

  const fuseOpts: Record<string, unknown> = {
    force: true,
    debug: opts.debug,
    fsname: `Unidisk-${opts.module}`,
  }
  if (IS_OSX) {
    // macOS OSXFUSE / macFUSE needs an explicit iosize hint for performance.
    fuseOpts['maxRead'] = fuseIoSize
  }

  // Capture string value so the closure below doesn't need opts to be non-null.
  const { mountPoint } = opts
  const mode = opts.writable ? 'read-write' : 'read-only'

  // Auto-create the mount point directory if it doesn't exist yet.
  await fs.mkdir(mountPoint, { recursive: true })

  logger.info(`Mounting ${mode} at ${mountPoint}`)

  const fuse = await mount(mountPoint, handlers, fuseOpts)
  logger.info(`Filesystem ready — Ctrl-C to unmount`)

  // Graceful unmount on SIGINT (Ctrl-C) or SIGTERM.
  async function shutdown(signal: string): Promise<void> {
    logger.info(`${signal} received — unmounting ${mountPoint}`)
    try {
      await unmount(fuse)
      logger.info('Unmounted cleanly')
    } catch (err) {
      logger.error(`Unmount error: ${err}`)
    }
    process.exit(0)
  }

  process.once('SIGINT',  () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

// Only run as a CLI when executed directly, not when imported as a module.
if (require.main === module) {
  main().catch(err => {
    logger.error(`Fatal: ${err}`)
    process.exit(1)
  })
}
