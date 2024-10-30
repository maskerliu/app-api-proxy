import {
  app, BrowserWindow, BrowserWindowConstructorOptions,
  ipcMain, IpcMainEvent, Menu, nativeImage, nativeTheme, session, Tray
} from 'electron'
import fs from 'fs'
import path from 'path'
import { USER_DATA_DIR } from './common/Const'
import { MainServer } from './MainServer'
import { error } from 'console'


const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)

export default class MainApp {
  private mainWindow: BrowserWindow = null
  private gameWindow: BrowserWindow = null

  private appTray: Tray = null
  private winURL: string = process.env.NODE_ENV === 'development' ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
  private trayFloder: string = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../../build/icons') : path.join(__dirname, './static')
  private trayIconName: string = process.platform === 'win32' ? "icon.ico" : "icon.icns"

  private mainServer: MainServer = new MainServer()

  constructor() {
    this.mainServer.bootstrap()
  }

  public startApp() {
    if (process.platform == 'linux') {
      this.initAppEnv()
      try {
        this.mainServer.start()
      } catch (error) {
        console.error(error)
      }

      return
    }

    if (process.platform === 'win32') {
      app.disableHardwareAcceleration()
    }
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    // app.commandLine.appendSwitch('disable-gpu')
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
      { label: '用例管理', },
      { label: '设置', },
      {
        label: '退出', click: () => {
          app.quit()
        }
      }
    ])
    tray.setToolTip('AppApiProxy')
    tray.setContextMenu(contextMenu)
    // Menu.setApplicationMenu(null)
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
      minWidth: 1024,
      minHeight: 640,
      useContentSize: true,
      transparent: false,
      frame: true,
      resizable: true,
      icon: nativeImage.createFromPath(path.join(this.trayFloder, this.trayIconName)),
      show: false,
      titleBarStyle: process.platform === 'win32' ? 'default' : 'hidden',
      webPreferences: {
        // devTools: process.env.NODE_ENV == 'development',
        sandbox: false,
        preload: path.join(__dirname, 'preload.cjs')
      },
    }

    this.mainWindow = new BrowserWindow(winOpt)
    this.mainWindow.loadURL(this.winURL)
    this.mainWindow.webContents.frameRate = 30

    if (process.env.NODE_ENV == 'development') {
      this.mainWindow.webContents.openDevTools()
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow.destroy()
      this.mainWindow = null
    })

    this.mainWindow.on('ready-to-show', () => {
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
    ipcMain.handle('openGame', (envent: IpcMainEvent, args?: any) => {
      // this.createGameWindow(args[0])
    })

  }

  private registerThemeChanged() {

    nativeTheme.on("updated", () => {

    })
  }

}