import axios from 'axios'
import { spawn, SpawnOptions, StdioOptions } from 'child_process'
import crypto from 'crypto'
import { app, autoUpdater, BrowserWindow } from 'electron'
import fs, { createReadStream, createWriteStream } from 'fs'
import os from 'os'
import path from 'path'
import process from 'process'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import type { Version } from '@shared/base.models'
import { MainApiCmd } from '@shared/ipc.api'
import { AppName, IS_DEV, USER_DATA_DIR } from './MainConst'

export interface InstallOptions {
  readonly installerPath: string
  readonly isSilent: boolean
  readonly isForceRunAfter: boolean
  readonly isAdminRightsRequired: boolean
}


const DOWNLOAD_TIMEOUT = 60_000

let activeUpdate: AbortController | null = null

export async function runUpdate(version: Version) {
  if (activeUpdate != null) {
    console.warn('update already in progress, duplicated request ignored')
    return
  }

  const controller = new AbortController()
  activeUpdate = controller
  try {
    if (version.fullUpdate) await fullUpdate(version, controller.signal)
    else await incrementUpdate(version, controller.signal)
  } finally {
    if (activeUpdate === controller) activeUpdate = null
  }
}

export function cancelUpdate() {
  activeUpdate?.abort()
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const err = new Error('update aborted')
  err.name = 'AbortError'
  throw err
}

export async function incrementUpdate(version: Version, signal?: AbortSignal) {
  const updateDir = path.join(USER_DATA_DIR, 'update')
  const sourceFile = path.join(updateDir, `app-${version.version}.gz`)
  // 先解压到用户目录（始终可写），安装目录不可写时由重启 helper 提权替换
  const stagedFile = path.join(updateDir, 'update.asar')
  const resourcesAsar = path.join(process.resourcesPath, 'update.asar')
  fs.mkdirSync(updateDir, { recursive: true })
  fs.rmSync(sourceFile, { force: true })
  fs.rmSync(stagedFile, { force: true })

  try {
    const resp = await axios({
      url: version.updateUrl, method: 'GET', responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT, signal,
      onDownloadProgress: (event) => {
        notifyDownloadProgress(event.total ? Math.min(99, Math.round((event.loaded / event.total) * 100)) : 0)
      }
    })
    await pipeline(resp.data, createWriteStream(sourceFile), { signal })
    throwIfAborted(signal)

    const digest = await sha512File(sourceFile)
    if (digest !== version.sha512) {
      console.log('文件破损，请重新下载！！')
      fs.rmSync(sourceFile, { force: true })
      notifyDownloadFailed('更新包校验失败，请重新下载')
      return
    }

    await pipeline(createReadStream(sourceFile), createGunzip(), createWriteStream(stagedFile), { signal })
    throwIfAborted(signal)

    if (IS_DEV) {
      fs.rmSync(path.join(USER_DATA_DIR, 'update.asar'), { force: true })
      fs.renameSync(stagedFile, path.join(USER_DATA_DIR, 'update.asar'))
    } else if (process.platform != 'win32') {
      fs.rmSync(resourcesAsar, { force: true })
      fs.copyFileSync(stagedFile, resourcesAsar)
      fs.rmSync(stagedFile, { force: true })
    } else {
      try {
        fs.rmSync(resourcesAsar, { force: true })
        fs.copyFileSync(stagedFile, resourcesAsar)
        fs.rmSync(stagedFile, { force: true })
      } catch (err: any) {
        // Program Files 等受保护目录：保留暂存文件，重启时通过 UAC 提权替换
        if (err?.code != 'EACCES' && err?.code != 'EPERM') throw err
        console.log('安装目录无写权限，更新包已暂存，重启时提权应用:', err.code)
      }
    }
    notifyDownloadProgress(100)
  } catch (err) {
    fs.rmSync(sourceFile, { force: true })
    fs.rmSync(stagedFile, { force: true })
    if (signal?.aborted || axios.isCancel(err)) {
      console.log('increment update cancelled')
      notifyDownloadFailed('更新已取消')
      return
    }
    console.error('increment update failed:', err)
    notifyDownloadFailed('更新下载失败，请重试')
  }
}

let autoUpdaterConfigured = false

function configureMacAutoUpdater() {
  if (autoUpdaterConfigured) return
  autoUpdaterConfigured = true

  autoUpdater.on("error", it => {
    console.error('autoUpdater error:', it)
  })
  autoUpdater.on("update-downloaded", () => {
    console.log('received update-downloaded event')
    autoUpdater.quitAndInstall()
  })
}

export async function fullUpdate(version: Version, signal?: AbortSignal) {
  const platform = os.platform()
  if (platform == 'linux') {
    notifyDownloadFailed('当前平台暂不支持全量更新，请使用增量更新或手动安装')
    throw new Error('full update is not supported on linux')
  }
  if (platform == 'darwin') configureMacAutoUpdater()

  const ext = platform == 'darwin' ? 'zip' : 'exe'
  const updateDir = path.join(USER_DATA_DIR, 'update')
  const installerPath = path.join(updateDir, `installer-${version.version}.${ext}`)
  const partFile = `${installerPath}.part`
  fs.mkdirSync(updateDir, { recursive: true })
  fs.rmSync(partFile, { force: true })
  fs.rmSync(installerPath, { force: true })

  try {
    const resp = await axios({
      url: version.updateUrl, method: 'GET', responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT, signal,
      onDownloadProgress: (event) => {
        notifyDownloadProgress(event.total ? Math.min(99, Math.round((event.loaded / event.total) * 100)) : 0)
      }
    })
    await pipeline(resp.data, createWriteStream(partFile), { signal })
    throwIfAborted(signal)
  } catch (err) {
    fs.rmSync(partFile, { force: true })
    if (signal?.aborted || axios.isCancel(err)) {
      console.log('full update cancelled')
      notifyDownloadFailed('更新已取消')
      return
    }
    console.error('download installer failed:', err)
    notifyDownloadFailed('更新下载失败，请重试')
    throw err
  }

  if (!version.sha512) {
    fs.rmSync(partFile, { force: true })
    notifyDownloadFailed('更新包缺少校验信息，无法安装')
    throw new Error('missing sha512 for full update')
  }
  const digest = await sha512File(partFile)
  if (digest !== version.sha512) {
    fs.rmSync(partFile, { force: true })
    notifyDownloadFailed('更新包校验失败，请重新下载')
    throw new Error('update package verification failed')
  }
  if (signal?.aborted) {
    fs.rmSync(partFile, { force: true })
    notifyDownloadFailed('更新已取消')
    return
  }

  try {
    fs.renameSync(partFile, installerPath)
  } catch (err) {
    fs.rmSync(partFile, { force: true })
    console.error('save installer failed:', err)
    notifyDownloadFailed('更新包保存失败，请重试')
    throw err
  }
  notifyDownloadProgress(100)

  let opt = {
    installerPath,
    isSilent: false,
    isForceRunAfter: false,
    isAdminRightsRequired: false
  }

  switch (platform) {
    case 'win32':
      return await doWinInstall(opt)
    case 'darwin':
      return await doMacInstall(opt)
  }
  return false
}

function notifyDownloadProgress(progress: number) {
  notifyDownloadEvent({ progress })
}

function notifyDownloadFailed(error: string) {
  notifyDownloadEvent({ progress: 0, error })
}

function notifyDownloadEvent(event: { progress: number, error?: string }) {
  const win = BrowserWindow.getAllWindows().find(it => it.title == AppName)
  if (win == null || win.isDestroyed()) return
  win.webContents.send(MainApiCmd.DownloadUpdate, event)
}

function sha512File(file: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha512')
    createReadStream(file)
      .on('data', (chunk: any) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject)
  })
}

async function doMacInstall(options: InstallOptions) {
  autoUpdater.setFeedURL({ url: `file://${options.installerPath}` })
  autoUpdater.checkForUpdates()
  autoUpdater.emit('update-downloaded')
}

async function doWinInstall(options: InstallOptions) {
  const args = ["--updated"]
  if (options.isSilent) args.push("/S")
  if (options.isForceRunAfter) args.push("--force-run")
  let installDir = IS_DEV ? '' : path.dirname(app.getPath('exe'))
  args.push(`/D=${installDir}`)

  const callUsingElevation = (): void => {
    spawnLog(path.join(process.resourcesPath, 'elevate.exe'),
      [options.installerPath].concat(args)).catch(e => console.log(e))
  }

  if (options.isAdminRightsRequired) {
    console.log('isAdminRightsRequired is set to true, run installer using elevate.exe')
    callUsingElevation()
    return true
  }

  spawnLog(options.installerPath, args).catch((e: Error) => {
    // https://github.com/electron-userland/electron-builder/issues/1129
    const errorCode = (e as NodeJS.ErrnoException).code
    console.log(
      `Cannot run installer: 
      error code: ${errorCode}, 
      error message: "${e.message}", 
      will be executed again using elevate if EACCES, and will try to use electron.shell.openItem if ENOENT`
    )
    if (errorCode === "UNKNOWN" || errorCode === "EACCES") {
      callUsingElevation()
    } else if (errorCode === "ENOENT") {
      require("electron")
        .shell.openPath(options.installerPath)
        .catch(err => console.log(err))

      app.quit()
    } else {
      console.log(e)
    }
  })
  return true
}

async function spawnLog(cmd: string, args: string[] = [], env: any = undefined, stdio: StdioOptions = "ignore"): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    try {
      const params: SpawnOptions = { stdio, env, detached: true }
      const p = spawn(cmd, args, params)
      p.on("error", error => reject(error))
      p.unref()
      if (p.pid !== undefined) {
        resolve(true)
      }
      app.quit()
    } catch (error) {
      reject(error)
    }
  })
}
