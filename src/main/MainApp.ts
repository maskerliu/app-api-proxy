import axios from 'axios'
import { spawn, SpawnOptions, StdioOptions } from 'child_process'
import crypto from 'crypto'
import {
  app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain,
  Menu, nativeImage, nativeTheme, session, Tray
} from 'electron'
import fse from 'fs-extra'
import fs, { createReadStream, createWriteStream } from 'original-fs'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import { Version } from '../common'
import { ElectronAPICMD } from '../common/ipc.api'
import { USER_DATA_DIR } from './MainConst'
import { MainServer } from './MainServer'

const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)
const IS_DEV = process.env.NODE_ENV === 'development'
const VUE_PLUGIN = 'D:/vue-devtools/7.6.5_0'

export default class MainApp {
  private mainWindow: BrowserWindow = null
  private winURL: string = IS_DEV ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
  private trayIconFile: string
  private mainServer: MainServer = new MainServer()

  constructor() {
    let iconDir = IS_DEV ? path.join(__dirname, '../../icons') : path.join(__dirname, './static')
    let ext = ''
    switch (process.platform) {
      case 'win32':
        ext = 'ico'
        break
      case 'darwin':
        ext = 'icns'
        break
      case 'linux':
        ext = 'png'
        break
    }
    this.trayIconFile = path.join(iconDir, `icon.${ext}`)
    this.mainServer.bootstrap()
  }

  public async startApp() {
    console.log(os.platform(), os.release())
    if (process.env.NODE_ENV == 'development') {
      app.commandLine.appendSwitch('trace-warnings')
      app.commandLine.appendSwitch('experimental-worker')
      app.commandLine.appendSwitch('experimental-wasm-threads')
      app.commandLine.appendSwitch('inspect', '5858')
      app.commandLine.appendSwitch('unhandled-rejections', 'strict')
    }

    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    app.commandLine.appendSwitch('disable-gpu')
    // app.commandLine.appendSwitch('disable-software-rasterizer')
    app.disableHardwareAcceleration()

    if (os.platform() == 'linux' && os.userInfo().username == 'root') {
      app.commandLine.appendSwitch('disable-chromium-sandbox')
      app.commandLine.appendSwitch('disable-gpu-sandbox')
      app.commandLine.appendSwitch('no-sandbox')
    }

    app.on('activate', () => {
      if (this.mainWindow == null) {
        this.createMainWindow()
      }
    })

    app.on('ready', () => {
      let lock = app.requestSingleInstanceLock()
      if (!lock) app.quit()

      this.initSessionConfig()
      this.initIPCService()

      if (this.mainWindow == null) {
        this.createMainWindow()
      }
      if (process.platform == 'win32') this.createTrayMenu()
    })

    app.on('second-instance', (_, args, workDir) => {
      console.log(args, workDir)
    })

    app.on('before-quit', () => {
      app.releaseSingleInstanceLock()
    })

    app.on('window-all-closed', () => {
      console.log('window all closed')
      this.mainWindow?.destroy()
      this.mainWindow = null
      if (os.platform() !== 'win32') app.quit()
    })

    Menu.setApplicationMenu(null)

    this.initAppEnv()
    try {
      await this.mainServer.start()
    } catch (error) {
      console.error(error)
    }
  }

  private createMainWindow() {

    if (this.mainWindow != null) {
      this.mainWindow.show()
      return
    }

    let winOpt: BrowserWindowConstructorOptions = {
      icon: nativeImage.createFromPath(this.trayIconFile),
      title: "AppApiProxy",
      width: 1100,
      height: 670,
      minHeight: 640,
      useContentSize: true,
      transparent: false,
      frame: true,
      resizable: true,
      show: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      titleBarOverlay: { color: "#f8f8f800", symbolColor: "black" },
      webPreferences: {
        webSecurity: false,
        devTools: true, //process.env.NODE_ENV == 'development',
        nodeIntegration: true,
        sandbox: false,
        preload: path.join(__dirname, 'preload.cjs')
      },
    }

    this.mainWindow = new BrowserWindow(winOpt)
    this.mainWindow.loadURL(this.winURL)
    this.mainWindow.webContents.frameRate = 30
    this.mainWindow.setVibrancy('window')

    // this.mainWindow.on('close', (e) => {
    //   console.log('hide mainWindow')
    //   if (process.platform == 'win32') {
    //     this.mainWindow.hide()
    //   } else {
    //     if (BrowserWindow.getAllWindows.length > 0) {
    //       this.mainWindow.hide()
    //     }
    //   }
    //   e.preventDefault()
    // })

    this.mainWindow.on('closed', () => {
      // console.log(this.mainWindow)
    })

    this.mainWindow.on('ready-to-show', () => {
      this.mainWindow.show()
      this.mainWindow.focus()
      this.mainWindow.webContents.send(ElectronAPICMD.GetSysSettings, this.mainServer.getSysSettings())
    })
  }

  private createTrayMenu() {
    let tray = new Tray(this.trayIconFile)
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '用例管理', click: () => {
          this.mainWindow.show()
          this.mainWindow.webContents.send(ElectronAPICMD.OpenMockRuleMgr)
        }
      },
      {
        label: '设置', click: () => {
          this.mainWindow.show()
          this.mainWindow.webContents.send(ElectronAPICMD.OpenSettings)
        }
      },
      {
        label: '退出', click: () => {
          this.mainServer.stop()
          app.quit()
        }
      }
    ])

    tray.on('click', () => {
      if (this.mainWindow == null) {
        this.createMainWindow()
      }
    })

    tray.setToolTip('AppApiProxy')
    tray.setContextMenu(contextMenu)
  }

  private initAppEnv() {
    let resPath = path.join(USER_DATA_DIR, './static')
    fs.access(resPath, err => {
      if (err) {
        fs.mkdir(resPath, err => console.log(err))
      }
    })
    let dbPath = path.join(USER_DATA_DIR, './biz_storage')
    fs.access(dbPath, err => {
      if (err) {
        fs.mkdir(dbPath, err => console.log(err))
      }
    })
    let updatePath = path.join(USER_DATA_DIR, './update')
    fs.access(updatePath, err => {
      if (err) {
        fs.mkdir(updatePath, err => console.log(err))
      }
    })
  }

  private initSessionConfig() {
    if (IS_DEV && process.platform == 'win32') session.defaultSession.loadExtension(VUE_PLUGIN)

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.indexOf('.amap.com') !== -1
        || details.url.indexOf('alicdn.com') !== -1) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Resource-Policy': 'cross-origin'
          },
        })
      } else {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          }
        })
      }
    })
  }

  private initIPCService() {

    ipcMain.handle(ElectronAPICMD.Relaunch, (_) => {
      if (fse.pathExistsSync(path.join(process.resourcesPath, 'update.asar'))) {
        const logPath = app.getPath('logs')
        const out = fs.openSync(path.join(logPath, 'out.log'), 'a')
        const err = fs.openSync(path.join(logPath, 'err.log'), 'a')
        const child = spawn(
          `"${path.join(process.resourcesPath, process.platform == 'win32' ? 'update.exe' : 'update.sh')}"`,
          [`"${process.resourcesPath}"`, `"${app.getPath('exe')}"`],
          {
            detached: true,
            shell: true,
            stdio: ['ignore', out, err]
          })
        child.unref()
      } else {
        app.relaunch({ execPath: app.isPackaged ? process.execPath : __dirname })
      }
      app.quit()
    })

    ipcMain.handle(ElectronAPICMD.OpenDevTools, (_, args?: any) => {
      this.mainWindow.webContents.openDevTools({ mode: 'detach', activate: false })
    })

    ipcMain.handle(ElectronAPICMD.SaveSysSettings, (_, ...args: any) => {
      this.mainServer.updateSysSettings(JSON.parse(args))
      this.mainServer.stop()
      this.mainServer.start()
      this.mainWindow.webContents.send(ElectronAPICMD.GetSysSettings, this.mainServer.getSysSettings())
    })

    ipcMain.handle(ElectronAPICMD.SetAppTheme, (_, theme: ('system' | 'light' | 'dark')) => {
      nativeTheme.themeSource = theme
      this.mainWindow.setTitleBarOverlay({
        color: '#f8f8f800',
        symbolColor: nativeTheme.shouldUseDarkColors ? 'white' : 'black'
      })
    })

    ipcMain.handle(ElectronAPICMD.DownloadUpdate, async (_, newVersion: Version) => {
      if (newVersion.fullUpdate) await this.fullUpdate(newVersion)
      else await this.incrementUpdate(newVersion)
    })

    nativeTheme.on("updated", () => {
      let theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      this.mainWindow.webContents.send(ElectronAPICMD.SysThemeChanged, theme)
    })
  }

  async fullUpdate(version: Version) {
    let ext = ''
    switch (process.platform) {
      case 'win32':
        ext = 'exe'
        break
      case 'darwin':
        ext = 'zip'
        break
      case 'linux':
        ext = 'AppImage'
        break
    }

    let downloadDir = path.join(USER_DATA_DIR, 'update', `installer-${version.version}.${ext}`)
    if (process.platform == 'linux') downloadDir.replace(/ /g, "\\ ")

    try { fs.rmSync(downloadDir) } catch (err) { console.log('fail to delete file', downloadDir) }
    const resp = await axios({
      url: version.updateUrl, method: 'GET', responseType: 'stream',
      onDownloadProgress: (event) => {
        this.mainWindow.webContents.send(ElectronAPICMD.DownloadUpdate,
          { progress: Math.round((event.loaded / event.total) * 100) })
      }
    })
    await pipeline(resp.data, createWriteStream(downloadDir))

    await this.doInstall({
      installerPath: downloadDir,
      isSilent: false,
      isForceRunAfter: false,
      isAdminRightsRequired: false
    })
  }

  async doInstall(options: InstallOptions) {
    switch (process.platform) {
      case 'win32':
        return await this.doWinInstall(options)
      case 'darwin':
        return await this.doMacInstall(options)
      case 'linux':
        return await this.doLinuxInstall(options)
    }
  }

  async doMacInstall(options: InstallOptions) {
    // TODO implement linux rpm full update
    return false
  }

  async doWinInstall(options: InstallOptions) {
    const args = ["--updated"]
    if (options.isSilent) args.push("/S")
    if (options.isForceRunAfter) args.push("--force-run")
    let installDir = IS_DEV ? '' : path.dirname(app.getPath('exe'))
    console.log('install dir:', installDir)
    args.push(`/D=${path.dirname(path.dirname(app.getPath('exe')))}`)

    const callUsingElevation = (): void => {
      this.spawnLog(path.join(process.resourcesPath, 'elevate.exe'), [options.installerPath].concat(args)).catch(e => console.log(e))
    }

    if (options.isAdminRightsRequired) {
      console.log('isAdminRightsRequired is set to true, run installer using elevate.exe')
      callUsingElevation()
      return true
    }

    this.spawnLog(options.installerPath, args).catch((e: Error) => {
      // https://github.com/electron-userland/electron-builder/issues/1129
      const errorCode = (e as NodeJS.ErrnoException).code
      console.log(
        `Cannot run installer: error code: ${errorCode}, error message: "${e.message}", will be executed again using elevate if EACCES, and will try to use electron.shell.openItem if ENOENT`
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

  async doLinuxInstall(options: InstallOptions) {
    // TODO implement linux rpm full update
    return false
  }
  protected async spawnLog(cmd: string, args: string[] = [], env: any = undefined, stdio: StdioOptions = "ignore"): Promise<boolean> {
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

  async incrementUpdate(version: Version) {
    let sourceDir = path.join(USER_DATA_DIR, 'update', `app-${version.version}.gz`)
    try { fs.rmSync(sourceDir) } catch (err) { console.log('fail to delete file', sourceDir) }
    const resp = await axios({
      url: version.updateUrl, method: 'GET', responseType: 'stream',
      onDownloadProgress: (event) => {
        this.mainWindow.webContents.send(ElectronAPICMD.DownloadUpdate,
          { progress: Math.round((event.loaded / event.total) * 100) })
      }
    })
    await pipeline(resp.data, createWriteStream(sourceDir))
    let destDir = path.join(IS_DEV ? USER_DATA_DIR : process.resourcesPath, 'update.asar')
    // if (IS_DEV) return
    let hash = crypto.createHash('sha512')
    let digest = ''
    try {
      let source = createReadStream(sourceDir)
      let dest = createWriteStream(destDir)
      source.on('data', (chunk: any) => hash.update(chunk))
      source.on('end', () => { digest = hash.digest('base64') })
      await pipeline(source, createGunzip(), dest)
      if (digest == version.sha512) console.log('文件校验通过, 重启安装更新')
      else console.log('文件破损，请重新下载！！')
    } catch (err) { console.log(err) }
  }
}

export interface InstallOptions {
  readonly installerPath: string
  readonly isSilent: boolean
  readonly isForceRunAfter: boolean
  readonly isAdminRightsRequired: boolean
}
