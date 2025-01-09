import {
  app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain,
  Menu,
  session, Tray
} from 'electron'
import fs from 'original-fs'
import os from 'os'
import path from 'path'
import { ElectronAPICMD } from '../common/ipc.api'
import './IPCServices'
import { IS_DEV, USER_DATA_DIR } from './MainConst'
import { MainServer } from './MainServer'

const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)

const VUE_PLUGIN = os.platform() == 'darwin' ? '~/Downloads/vue-devtools/7.6.8_0' : 'D:/vue-devtools/7.6.5_0'

export default class MainApp {
  private mainWindow: BrowserWindow = null
  private winURL: string = IS_DEV ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
  private iconDir: string
  private trayIconFile: string
  private mainServer: MainServer = new MainServer()

  constructor() {
    this.iconDir = IS_DEV ? path.join(__dirname, '../../icons') : path.join(__dirname, './static')
    let ext = os.platform() == 'win32' ? 'ico' : 'png'
    this.trayIconFile = path.join(this.iconDir, `icon.${ext}`)
    this.mainServer.bootstrap()
  }

  public async startApp() {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-software-rasterizer')

    if (process.env.NODE_ENV == 'development') {
      app.commandLine.appendSwitch('trace-deprecation')
      app.commandLine.appendSwitch('trace-warnings')
      app.commandLine.appendSwitch('experimental-worker')
      app.commandLine.appendSwitch('experimental-wasm-threads')
      app.commandLine.appendSwitch('unhandled-rejections', 'strict')
      app.commandLine.appendSwitch('inspect', '5858')
    }

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

      this.createTrayMenu()
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
      icon: this.trayIconFile,
      title: "AppApiProxy",
      width: 1100,
      height: 670,
      minHeight: 640,
      useContentSize: true,
      transparent: false,
      frame: true,
      resizable: true,
      show: false,
      titleBarStyle: os.platform() === 'darwin' ? 'hidden' : 'hidden',
      titleBarOverlay: { color: "#f8f8f800", symbolColor: "black" },
      trafficLightPosition: { x: os.platform() == 'darwin' ? 1030 : 10, y: 10 },
      webPreferences: {
        offscreen: false,
        webSecurity: false,
        devTools: true, //process.env.NODE_ENV == 'development',
        nodeIntegration: true,
        sandbox: false,
        preload: path.join(__dirname, 'preload.cjs')
      },
    }

    this.mainWindow = new BrowserWindow(winOpt)
    this.mainWindow.loadURL(this.winURL)
    this.mainWindow.setVibrancy('window')

    this.mainWindow.on('resize', () => {

      if (os.platform() == 'darwin')
        this.mainWindow.setWindowButtonPosition({ x: this.mainWindow.getBounds().width - 70, y: 10 })
    })

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
    let tray = new Tray(path.join(this.iconDir, 'icon-tray.png'))
    const contextMenu = Menu.buildFromTemplate([
      {
        icon: path.join(this.iconDir, 'ic-rule.png'),
        label: '用例管理',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(ElectronAPICMD.OpenMockRuleMgr)
        }
      },
      {
        icon: path.join(this.iconDir, 'ic-setting.png'),
        label: '设置',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(ElectronAPICMD.OpenSettings)
        }
      },
      {
        icon: path.join(this.iconDir, 'ic-exit.png'),
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
    let resPath = path.join(USER_DATA_DIR, 'static')
    fs.access(resPath, err => {
      if (err) {
        fs.mkdir(resPath, err => console.log(err))
      }
    })
    let dbPath = path.join(USER_DATA_DIR, 'biz_storage')
    fs.access(dbPath, err => {
      if (err) {
        fs.mkdir(dbPath, err => console.log(err))
      }
    })
    let updatePath = path.join(USER_DATA_DIR, 'update')
    fs.access(updatePath, err => {
      if (err) {
        fs.mkdir(updatePath, err => console.log(err))
      }
    })
  }

  private initSessionConfig() {
    if (IS_DEV && os.platform() != 'linux') session.defaultSession.loadExtension(VUE_PLUGIN)

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
    ipcMain.handle(ElectronAPICMD.SaveSysSettings, (_, ...args: any) => {
      this.mainServer.updateSysSettings(JSON.parse(args))
      this.mainServer.stop()
      this.mainServer.start()
      this.mainWindow.webContents.send(ElectronAPICMD.GetSysSettings, this.mainServer.getSysSettings())
    })

    ipcMain.handle(ElectronAPICMD.SendServerEvent, () => {
      console.log('send sse')
    })
  }
}