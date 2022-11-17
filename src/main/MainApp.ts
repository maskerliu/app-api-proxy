import {
  app, BrowserView, BrowserWindow, BrowserWindowConstructorOptions, ipcMain, IpcMainEvent,
  Menu, nativeImage, session, Tray
} from 'electron'
import fs from 'fs'
import path from 'path'
import { Fun } from '../common/fun.models'

import localServer from './MainServer'


const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)


export default class MainApp {
  private mainWindow: BrowserWindow = null
  private gameWindow: BrowserWindow = null

  private appTray: Tray = null
  private winURL: string = process.env.NODE_ENV === 'development' ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
  private trayFloder: string = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../../static') : path.join(__dirname, './static')

  public startApp() {
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

    app.on('ready', () => {
      this.initSessionConfig()
      this.initIPCService()

      if (this.mainWindow == null) {
        this.createMainWindow()
        this.createAppMenu()
      }
    })

    this.initAppEnv()
    localServer.start()
  }

  private createAppMenu() {
    Menu.setApplicationMenu(null)
  }

  private createMainWindow() {

    if (this.mainWindow != null) {
      this.mainWindow.show()
      return
    }

    let icon = nativeImage.createFromPath(path.join(this.trayFloder, 'icon_tray.png'))
    Menu.setApplicationMenu(null)

    let winOpt: BrowserWindowConstructorOptions = {
      width: 1200,
      height: 800,
      minWidth: 1024,
      minHeight: 640,
      useContentSize: true,
      transparent: false,
      frame: true,
      resizable: true,
      icon: icon,
      show: false,
      titleBarStyle: 'hidden',
      webPreferences: {
        devTools: process.env.NODE_ENV == 'development',
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
    let userDataPath = app.getPath('userData')
    let resPath = path.join(userDataPath, './static')
    fs.access(resPath, (err) => {
      if (err) {
        fs.mkdir(resPath, (err) => {
          console.log(err)
        })
      }
    })
    let dbPath = path.join(userDataPath, './biz_storage')
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
      this.createGameWindow(args[0])
    })

  }

  private createGameWindow(game: Fun.GameItem) {

    if (this.gameWindow == null) {
      let winOpt: BrowserWindowConstructorOptions = {
        width: 390,
        height: 844,
        parent: this.mainWindow,
        useContentSize: true,
        transparent: false,
        frame: true,
        resizable: false,
        icon: nativeImage.createFromDataURL(game.icon),
        show: false,
        titleBarStyle: 'default',
        webPreferences: {
          devTools: process.env.NODE_ENV == 'development',
          sandbox: false,
          preload: path.join(__dirname, 'preload.cjs')
        },
      }

      this.gameWindow = new BrowserWindow(winOpt)
      this.gameWindow.webContents.frameRate = 30

      if ( process.env.NODE_ENV == 'development') {
        this.gameWindow.webContents.openDevTools()
      }


      this.gameWindow.webContents.on('dom-ready', () => {
        const folderPath = process.env.NODE_ENV !== 'development'
          ? path.join(__dirname, './static')
          : path.join(__dirname, '../../static')

        this.gameWindow.webContents.executeJavaScript(
          fs.readFileSync(path.join(folderPath, 'YppJSBridge.js')).toString(),
        )
      })

      this.gameWindow.on('closed', () => {
        this.gameWindow.destroy()
        this.gameWindow = null
      })

      this.gameWindow.on('ready-to-show', () => {
        this.gameWindow.show()
        this.gameWindow.focus()
      })


    }

    this.gameWindow.loadURL(game.url)



  }


}