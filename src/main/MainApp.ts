import axios from 'axios'
import { spawn } from 'child_process'
import {
  app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain,
  Menu, nativeImage, nativeTheme, session, TitleBarOverlay, Tray
} from 'electron'
import fse from 'fs-extra'
import fs, { createReadStream, createWriteStream } from 'original-fs'
import path from 'path'
import { createGunzip } from 'zlib'
import { ElectronAPICMD } from '../common/ipc.api'
import { USER_DATA_DIR } from './MainConst'
import { MainServer } from './MainServer'

const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)
const IS_DEV = process.env.NODE_ENV === 'development'
const VUE_PLUGIN = 'D:/vue-devtools/7.6.5_0'

export default class MainApp {
  private mainWindow: BrowserWindow = null
  private winURL: string = IS_DEV ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
  private trayFloder: string = IS_DEV ? path.join(__dirname, '../../icons') : path.join(__dirname, './static')
  private trayIconName: string = process.platform === 'win32' ? "icon.ico" : "icon.icns"

  private mainServer: MainServer = new MainServer()

  constructor() {
    this.mainServer.bootstrap()
  }

  public startApp() {
    if (process.platform === 'win32') {
      // app.disableHardwareAcceleration()
    }
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    app.commandLine.appendSwitch('disable-gpu')
    // app.commandLine.appendSwitch('disable-software-rasterizer')
    app.on('window-all-closed', () => {
      // if (process.platform.toString() !== 'drawin') {
      //   MainApp.app.quit()
      // }
    })

    app.on('activate', () => {
      if (this.mainWindow == null) {
        this.createMainWindow()
      }
    })

    app.whenReady().then(() => {
      this.initSessionConfig()
      this.initIPCService()

      if (this.mainWindow == null) {
        this.createMainWindow()
        this.createAppMenu()
      }
    })

    this.initAppEnv()
    try {
      this.mainServer.start()
    } catch (error) {
      console.error(error)
    }
  }

  private createAppMenu() {
    let tray = new Tray(`${this.trayFloder}/${this.trayIconName}`)
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '用例管理', click: () => {
          if (this.mainWindow == null) this.createMainWindow()
          this.mainWindow.webContents.send(ElectronAPICMD.OpenMockRuleMgr)
        }
      },
      {
        label: '设置', click: () => {
          if (this.mainWindow == null) this.createMainWindow()
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

  private createMainWindow() {

    if (this.mainWindow != null) {
      this.mainWindow.show()
      return
    }

    Menu.setApplicationMenu(null)

    let winOpt: BrowserWindowConstructorOptions = {
      title: "AppApiProxy",
      width: 1100,
      height: 670,
      // minWidth: 1024,
      minHeight: 640,
      useContentSize: true,
      transparent: false,
      frame: true,
      resizable: true,
      icon: nativeImage.createFromPath(path.join(this.trayFloder, this.trayIconName)),
      show: false,
      titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
      titleBarOverlay: {
        color: "#f8f8f800",
        symbolColor: "black",
      },
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
    this.mainWindow.on('closed', () => {
      this.mainWindow.destroy()
      this.mainWindow = null
    })

    this.mainWindow.on('ready-to-show', () => {
      this.mainWindow.show()
      this.mainWindow.focus()
      this.mainWindow.webContents.send(ElectronAPICMD.GetSysSettings, this.mainServer.getSysSettings())
    })
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
    if (IS_DEV) session.defaultSession.loadExtension(VUE_PLUGIN)

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
      if (fse.pathExistsSync(path.join(process.resourcesPath, './update.asar'))) {
        const logPath = app.getPath('logs')
        const out = fs.openSync(path.join(logPath, './out.log'), 'a')
        const err = fs.openSync(path.join(logPath, './err.log'), 'a')
        const child = spawn(
          `"${path.join(process.resourcesPath, './update.exe')}"`,
          [`"${process.resourcesPath}"`, `"${app.getPath('exe')}"`],
          {
            detached: true,
            shell: true,
            stdio: ['ignore', out, err]
          })
        child.unref()
      } else {
        app.relaunch({ execPath: app.isPackaged ? process.execPath : __dirname })
        app.quit()
      }
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

      let opts: TitleBarOverlay = { color: '#f8f8f808', symbolColor: 'black' }
      if (nativeTheme.shouldUseDarkColors) {
        opts.color = '#27272808'
        opts.symbolColor = 'white'
      }
      this.mainWindow.setTitleBarOverlay(opts)
    })

    ipcMain.handle(ElectronAPICMD.DownloadUpdate, async (_, newVersion: any) => {
      let sourceDir = `${USER_DATA_DIR}/update/app-${newVersion.version}.gz`
      try { fs.rmSync(sourceDir) } catch (err) { console.log('fail to delete file', err) }

      await this.downloadFile(newVersion.updateUrl, sourceDir)

      let destDir = path.join(process.resourcesPath, 'update.asar')
      // let destDir = path.join(USER_DATA_DIR, 'update.asar')
      if (IS_DEV) return
      try {
        let source = createReadStream(sourceDir)
        let dest = createWriteStream(destDir)
        source.pipe(createGunzip()).pipe(dest)
      } catch (err) { console.log(err) }
      try { fs.rmSync(sourceDir) } catch (err) { console.log('fail to delete file', err) }
    })

    nativeTheme.on("updated", () => {
      let theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      this.mainWindow.webContents.send(ElectronAPICMD.SysThemeChanged, theme)
    })
  }

  async downloadFile(url: string, dest: string) {
    const resp = await axios({
      url, method: 'GET', responseType: 'stream', onDownloadProgress: (event) => {
        this.mainWindow.webContents.send(ElectronAPICMD.DownloadUpdate, { progress: Math.round((event.loaded / event.total) * 100) })
      }
    })

    const writer = createWriteStream(dest)
    resp.data.pipe(writer)
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  }

}