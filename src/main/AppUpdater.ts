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


export async function incrementUpdate(version: Version) {
  const sourceFile = path.join(USER_DATA_DIR, 'update', `app-${version.version}.gz`)
  const destFile = path.join(IS_DEV ? USER_DATA_DIR : process.resourcesPath, 'tmp-update')
  try { fs.rmSync(sourceFile) } catch (err) { console.log('fail to delete file', sourceFile) }

  try {
    const resp = await axios({
      url: version.updateUrl, method: 'GET', responseType: 'stream',
      onDownloadProgress: (event) => {
        notifyDownloadProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 0)
      }
    })
    await pipeline(resp.data, createWriteStream(sourceFile))
    await pipeline(createReadStream(sourceFile), createGunzip(), createWriteStream(destFile))

    const digest = await sha512File(sourceFile)
    if (digest == version.sha512) {
      console.log('文件校验通过, 重启安装更新')
      fs.renameSync(destFile, path.join(IS_DEV ? USER_DATA_DIR : process.resourcesPath, 'update.asar'))
    } else {
      console.log('文件破损，请重新下载！！')
      try { fs.rmSync(destFile, { force: true }) } catch (_) { }
    }
  } catch (err) {
    console.error('increment update failed:', err)
    try { fs.rmSync(destFile, { force: true }) } catch (_) { }
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

export async function fullUpdate(version: Version) {
  if (os.platform() == 'darwin') configureMacAutoUpdater()

  let ext = os.platform() == 'linux' ? 'AppImage' : os.platform() == 'darwin' ? 'zip' : 'exe'
  let downloadDir = path.join(USER_DATA_DIR, 'update', `installer-${version.version}.${ext}`)

  try { fs.rmSync(downloadDir) } catch (err) { console.log('fail to delete file', downloadDir) }

  try {
    const resp = await axios({
      url: version.updateUrl, method: 'GET', responseType: 'stream',
      onDownloadProgress: (event) => {
        notifyDownloadProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 0)
      }
    })
    await pipeline(resp.data, createWriteStream(downloadDir))
  } catch (err) {
    console.error('download installer failed:', err)
    try { fs.rmSync(downloadDir, { force: true }) } catch (_) { }
    throw err
  }

  let opt = {
    installerPath: downloadDir,
    isSilent: false,
    isForceRunAfter: false,
    isAdminRightsRequired: false
  }

  switch (os.platform()) {
    case 'win32':
      return await doWinInstall(opt)
    case 'darwin':
      return await doMacInstall(opt)
    case 'linux':
      return await doLinuxInstall(opt)
  }
  return false
}

function notifyDownloadProgress(progress: number) {
  const win = BrowserWindow.getAllWindows().find(it => it.title == AppName)
  if (win == null || win.isDestroyed()) return
  win.webContents.send(MainApiCmd.DownloadUpdate, { progress })
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

async function doLinuxInstall(options: InstallOptions) {
  // TODO implement linux AppImage full update



  return false
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
