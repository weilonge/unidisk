// Ambient declarations for third-party packages without @types.

declare module 'terabox-api' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class TeraBoxApp {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data:   Record<string, any>
    constructor(authData: string, authType?: string)
    updateAppData(customPath?: string, retries?: number): Promise<void>
    getQuota(): Promise<Record<string, unknown>>
    getRemoteDir(remoteDir: string, page?: number): Promise<Record<string, unknown>>
    download(fsIds: number[]): Promise<Record<string, unknown>>
    getFileMeta(files: unknown[]): Promise<Record<string, unknown>>
    createDir(remoteDir: string): Promise<Record<string, unknown>>
    filemanager(operation: string, params: unknown[]): Promise<Record<string, unknown>>
    precreateFile(data: Record<string, unknown>): Promise<Record<string, unknown>>
    uploadChunk(data: Record<string, unknown>, partseq: number, blob: Blob,
                reqHandler: null, abort: AbortSignal): Promise<Record<string, unknown>>
    createFile(data: Record<string, unknown>): Promise<Record<string, unknown>>
    checkLogin(): Promise<Record<string, unknown>>
  }
  export { TeraBoxApp }
}

// Minimal ambient declarations for fuse-native (no @types package exists).

declare module 'fuse-native' {
  interface StatObject {
    mode?: number
    uid?: number
    gid?: number
    size?: number
    nlink?: number
    dev?: number
    ino?: number
    rdev?: number
    blksize?: number
    blocks?: number
    atime?: Date | number
    mtime?: Date | number
    ctime?: Date | number
  }

  interface StatfsObject {
    bsize?: number
    frsize?: number
    blocks?: number
    bfree?: number
    bavail?: number
    files?: number
    ffree?: number
    favail?: number
    fsid?: number
    flag?: number
    namemax?: number
  }

  interface FuseHandlers {
    getattr?(path: string, cb: (err: number, stat?: StatObject) => void): void
    readdir?(path: string, cb: (err: number, names?: string[], stats?: StatObject[]) => void): void
    open?(path: string, flags: number, cb: (err: number, fd?: number) => void): void
    /** First callback arg is the FUSE return value: bytes read (>= 0) or -errno. */
    read?(path: string, fd: number, buf: Buffer, len: number, offset: number,
          cb: (bytesRead: number) => void): void
    /** First callback arg is the FUSE return value: bytes written (>= 0) or -errno. */
    write?(path: string, fd: number, buf: Buffer, len: number, offset: number,
           cb: (bytesWritten: number) => void): void
    release?(path: string, fd: number, cb: (err: number) => void): void
    releasedir?(path: string, fd: number, cb: (err: number) => void): void
    create?(path: string, mode: number, cb: (err: number, fd?: number) => void): void
    unlink?(path: string, cb: (err: number) => void): void
    rename?(src: string, dst: string, cb: (err: number) => void): void
    link?(src: string, dst: string, cb: (err: number) => void): void
    symlink?(src: string, dst: string, cb: (err: number) => void): void
    mkdir?(path: string, mode: number, cb: (err: number) => void): void
    rmdir?(path: string, cb: (err: number) => void): void
    truncate?(path: string, size: number, cb: (err: number) => void): void
    ftruncate?(path: string, fd: number, size: number, cb: (err: number) => void): void
    utimens?(path: string, atime: number, mtime: number, cb: (err: number) => void): void
    chown?(path: string, uid: number, gid: number, cb: (err: number) => void): void
    chmod?(path: string, mode: number, cb: (err: number) => void): void
    mknod?(path: string, mode: number, dev: number, cb: (err: number) => void): void
    flush?(path: string, fd: number, cb: (err: number) => void): void
    fsync?(path: string, datasync: number, fd: number, cb: (err: number) => void): void
    fsyncdir?(path: string, datasync: number, fd: number, cb: (err: number) => void): void
    setxattr?(path: string, name: string, value: Buffer, position: number, flags: number,
              cb: (err: number) => void): void
    getxattr?(path: string, name: string, position: number,
              cb: (err: number, value?: Buffer) => void): void
    listxattr?(path: string, cb: (err: number, list?: string[]) => void): void
    removexattr?(path: string, name: string, cb: (err: number) => void): void
    statfs?(path: string, cb: (err: number, stat?: StatfsObject) => void): void
    access?(path: string, mode: number, cb: (err: number) => void): void
    readlink?(path: string, cb: (err: number, linkname?: string) => void): void
    opendir?(path: string, flags: number, cb: (err: number, fd?: number) => void): void
    init?(cb: (err: number) => void): void
    error?(cb: (err: number) => void): void
  }

  interface FuseOptions {
    force?: boolean
    debug?: boolean
    mkdir?: boolean
    allowOther?: boolean
    allowRoot?: boolean
    autoUnmount?: boolean
    defaultPermissions?: boolean
    blkdev?: boolean
    blksize?: number
    maxRead?: number
    fd?: number
    fsname?: string
    subtype?: string
    kernelCache?: boolean
    autoCache?: boolean
    umask?: number
    uid?: number
    gid?: number
    entryTimeout?: number
    attrTimeout?: number
    timeout?: number | false | Record<string, number | false>
  }

  class Fuse {
    constructor(mountPoint: string, handlers: FuseHandlers, options?: FuseOptions)
    readonly mnt: string
    mount(cb: (err: Error | null) => void): void
    unmount(cb: (err: Error | null) => void): void

    static readonly EPERM: number
    static readonly ENOENT: number
    static readonly ESRCH: number
    static readonly EINTR: number
    static readonly EIO: number
    static readonly ENXIO: number
    static readonly EBADF: number
    static readonly EAGAIN: number
    static readonly ENOMEM: number
    static readonly EACCES: number
    static readonly EBUSY: number
    static readonly EEXIST: number
    static readonly ENODEV: number
    static readonly ENOTDIR: number
    static readonly EISDIR: number
    static readonly EINVAL: number
    static readonly ENOSPC: number
    static readonly EROFS: number
    static readonly ENOSYS: number
    static readonly ENOTEMPTY: number
    static readonly ENXIO: number

    static beforeMount(cb: (err: Error | null) => void): void
    static beforeUnmount(cb: (err: Error | null) => void): void
    static configure(cb: (err: Error | null) => void): void
    static unconfigure(cb: (err: Error | null) => void): void
    static isConfigured(cb: (err: Error | null, configured?: boolean) => void): void
  }

  export = Fuse
}
