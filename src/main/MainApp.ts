import {
  app, BrowserWindow, BrowserWindowConstructorOptions,
  globalShortcut, ipcMain, Menu, nativeImage, session, screen, Tray
} from 'electron'
import fs from 'original-fs'
import os from 'os'
import path from 'path'
import { MainAPICMD } from '../common/ipc.api'
import './IPCServices'
import { AppName, IS_DEV, USER_DATA_DIR } from './MainConst'
import { MainServer } from './MainServer'

const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)

const VUE_PLUGIN = os.platform() == 'darwin' ? '/Users/chris/Downloads/vue-devtools/7.6.8_0' : 'D:/vue-devtools/7.6.5_0'

export default class MainApp {
  private mainWindow: BrowserWindow = null
  private winURL: string = IS_DEV ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
  private staticDir: string
  private dockerIconFile: string
  private mainServer: MainServer = new MainServer()

  constructor() {
    this.staticDir = path.join(__dirname, IS_DEV ? '../../icons' : './static')
    let ext = os.platform() == 'win32' ? 'ico' : 'png'
    this.dockerIconFile = path.join(this.staticDir, `icon.${ext}`)
    this.mainServer.bootstrap()
 
    console.log('home', app.getPath('temp'))
  }

  public async startApp() {
    app.setName(AppName)
    // app.disableHardwareAcceleration()
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
      app.commandLine.appendSwitch('enable-feature', 'AutofillFeature')
    }

    if (os.platform() == 'linux' && os.userInfo().username == 'root') {
      app.commandLine.appendSwitch('disable-chromium-sandbox')
      app.commandLine.appendSwitch('disable-gpu-sandbox')
      app.commandLine.appendSwitch('no-sandbox')
      app.commandLine.appendSwitch('force-device-scale-factor', '2')
    }

    app.on('activate', () => {
      if (this.mainWindow == null) {
        this.createMainWindow()
      }
    })

    app.on('ready', () => {
      console.log(`screen info: ${screen.getPrimaryDisplay().scaleFactor}`)
      let display = screen.getPrimaryDisplay()
      console.log(`screen width: ${display.workAreaSize.width} \t height: ${display.workAreaSize.height}`)


      let icon = nativeImage.createFromPath(path.join(this.staticDir, 'icon.png'))
      console.log(`\t\t ${icon.getScaleFactors().length}\t ${icon.getScaleFactors()}`)

      globalShortcut.register('CommandOrControl+q', () => {
        app.quit()
      })

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
      icon: this.dockerIconFile,
      title: AppName,
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
        devTools: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, 'preload.cjs')
      },
    }

    this.mainWindow = new BrowserWindow(winOpt)
    this.mainWindow.loadURL(this.winURL)
    this.mainWindow.setVibrancy('window')
    this.mainWindow.webContents.session.setSpellCheckerEnabled(false)

    this.mainWindow.on('resize', () => {

      if (os.platform() == 'darwin')
        this.mainWindow.setWindowButtonPosition({ x: this.mainWindow.getBounds().width - 70, y: 10 })
    })

    this.mainWindow.on('closed', () => {
      // console.log(this.mainWindow)
    })

    this.mainWindow.webContents.openDevTools({ mode: 'detach', activate: false })

    this.mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
      console.error('preload error', error)
    })
    this.mainWindow.on('ready-to-show', () => {
      this.mainWindow.show()
      this.mainWindow.focus()
      this.mainWindow.webContents.send(MainAPICMD.GetSysSettings, this.mainServer.getSysSettings())
    })
  }

  private createTrayMenu() {

    let iconDir = IS_DEV ? path.join(this.staticDir, 'common') : this.staticDir
    let tray = new Tray(path.join(iconDir, 'icon-tray.png'))
    const contextMenu = Menu.buildFromTemplate([
      {
        icon: path.join(iconDir, 'ic-rule.png'),
        label: '用例管理',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(MainAPICMD.OpenMockRuleMgr)
        }
      },
      {
        icon: path.join(iconDir, 'ic-setting.png'),
        label: '设置',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(MainAPICMD.OpenSettings)
        }
      },
      {
        icon: path.join(iconDir, 'ic-debug.png'),
        label: '开发者面板',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(MainAPICMD.OpenDevTools)
        }
      },
      {
        icon: path.join(iconDir, 'ic-exit.png'),
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

    tray.setToolTip(AppName)
    tray.setContextMenu(contextMenu)
  }

  private initAppEnv() {
    let resPath = path.join(USER_DATA_DIR, 'static')
    fs.access(resPath, err => {
      if (err) fs.mkdir(resPath, err => console.log(err))
    })

    let dbPath = path.join(USER_DATA_DIR, 'biz_storage')
    fs.access(dbPath, err => {
      if (err) fs.mkdir(dbPath, err => console.log(err))
    })

    let updatePath = path.join(USER_DATA_DIR, 'update')
    fs.access(updatePath, err => {
      if (err) fs.mkdir(updatePath, err => console.log(err))
    })

    let dataPath = path.join(USER_DATA_DIR, 'data')
    fs.access(dataPath, err => {
      if (err) fs.mkdir(dataPath, err => console.log(err))
    })
  }

  private initSessionConfig() {

    if (IS_DEV && os.platform() != 'linux') session.defaultSession.extensions.loadExtension(VUE_PLUGIN)

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.indexOf('.amap.com') !== -1
        || details.url.indexOf('alicdn.com') !== -1
        || details.url.indexOf('qcloud.com')) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Access-Control-Allow-Origin': '*'
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
    ipcMain.handle(MainAPICMD.SaveSysSettings, (_, ...args: any) => {
      let curSettings = this.mainServer.getSysSettings()
      let newSettings = JSON.parse(args)

      this.mainServer.updateSysSettings(JSON.parse(args))

      if (newSettings.port !== curSettings.port || newSettings.protocol !== curSettings.protocol) {
        this.mainServer.stop()
        this.mainServer.start()
      }

      this.mainWindow.webContents.send(MainAPICMD.GetSysSettings, this.mainServer.getSysSettings())
    })

    ipcMain.handle(MainAPICMD.SendServerEvent, () => {
      // console.log('send sse')
    })
  }
}