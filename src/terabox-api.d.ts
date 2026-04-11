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
