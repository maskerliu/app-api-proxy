import {
  app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain, IpcMainEvent, Menu, nativeImage, nativeTheme, session, Tray
} from 'electron'
import fs from 'fs'
import path from 'path'
import { ElectronAPICMD } from '../common/ipc.api'
import { USER_DATA_DIR } from './MainConst'
import { MainServer } from './MainServer'


const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)
const IS_DEV = process.env.NODE_ENV === 'development'
const VUE_PLUGIN = 'C:/Users/lynxc/AppData/Local/Google/Chrome/User\ Data/Default/Extensions/nhdogjmejiglipccpnnnanhbledajbpd/7.6.5_0'

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
          this.mainWindow.webContents.send(ElectronAPICMD.openMockRuleMgr)
        }
      },
      {
        label: '设置', click: () => {
          if (this.mainWindow == null) this.createMainWindow()
          this.mainWindow.webContents.send(ElectronAPICMD.openSettings)
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
      width: 1200,
      height: 800,
      // minWidth: 1024,
      minHeight: 640,
      useContentSize: true,
      transparent: false,
      frame: true,
      resizable: true,
      icon: nativeImage.createFromPath(path.join(this.trayFloder, this.trayIconName)),
      show: false,
      titleBarStyle: process.platform === 'win32' ? 'default' : 'hidden',
      webPreferences: {
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
      this.mainWindow.webContents.send(ElectronAPICMD.getSysSettings, this.mainServer.getSysSettings())
      this.mainWindow.show()
      this.mainWindow.focus()
    })
  }

  private initAppEnv() {
    let resPath = path.join(USER_DATA_DIR, './static')
    fs.access(resPath, (err) => {
      if (err) {
        fs.mkdir(resPath, (err) => {
          console.log(err)
        })
      }
    })
    let dbPath = path.join(USER_DATA_DIR, './biz_storage')
    fs.access(dbPath, (err) => {
      if (err) {
        fs.mkdir(dbPath, (err) => {
          console.log(err)
        })
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
    ipcMain.handle('updateServerPort', (event: IpcMainEvent, args?: any) => {
      console.log(args)
    })

    ipcMain.handle(ElectronAPICMD.openDevTools, (event: IpcMainEvent, args?: any) => {
      this.mainWindow.webContents.openDevTools({ mode: 'detach', activate: false })
    })

    ipcMain.handle(ElectronAPICMD.saveSysSettings, (event: IpcMainEvent, ...args: any) => {
      this.mainServer.updateSysSettings(JSON.parse(args))
      this.mainServer.stop()
      this.mainServer.start()
      this.mainWindow.webContents.send(ElectronAPICMD.getSysSettings, this.mainServer.getSysSettings())
    })

    nativeTheme.on("updated", () => {
      this.mainWindow.webContents.send(ElectronAPICMD.sysThemeChanged)
    })
  }

}