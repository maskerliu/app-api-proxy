import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import path from 'path'

import localServer from "./MainServer"
require("./IPC")

export default class MainApp {
  static mainWindow: BrowserWindow = null

  static appTray: Tray = null
  static winURL: string = process.env.NODE_ENV === 'development' ? `http://localhost:9080` : `file://${__dirname}/index.html`
  static trayFloder: string = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../../static') : path.join(__dirname, './static')

  private static onWindowAllClosed() {
    // if (process.platform.toString() !== 'drawin') {
    //   MainApp.app.quit()
    // }
  }

  private static onClose() {
    MainApp.mainWindow = null
  }

  private static createMainWindow() {

    let icon = nativeImage.createFromPath(path.join(MainApp.trayFloder, 'icon_tray.png'))
    Menu.setApplicationMenu(null)

    if (MainApp.mainWindow != null) {
      MainApp.mainWindow.show()
      return
    }

    MainApp.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 1024,
      minHeight: 640,
      useContentSize: true,
      transparent: false,
      frame: true,
      resizable: true,
      icon: icon,
      titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
        offscreen: false,
        enableRemoteModule: false,
      },
    })

    MainApp.mainWindow.loadURL(MainApp.winURL)
    MainApp.mainWindow.webContents.frameRate = 30
    if (process.env.NODE_ENV !== 'production') {
      MainApp.mainWindow.webContents.openDevTools()
    }
    MainApp.mainWindow.on('closed', () => { MainApp.onClose() })
  }

  private static createAppMenu() {
    Menu.setApplicationMenu(null)
  }

  static start() {
    if (process.platform === 'win32') {
      app.disableHardwareAcceleration()
    }
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    // app.commandLine.appendSwitch('disable-gpu')
    // app.commandLine.appendSwitch('disable-software-rasterizer')
    app.on('window-all-closed', MainApp.onWindowAllClosed)
    app.on('activate', () => {
      if (MainApp.mainWindow == null) {
        MainApp.createMainWindow()
      }
    })
    app.on('ready', () => {
      if (MainApp.mainWindow == null){
        MainApp.createMainWindow()
        MainApp.createAppMenu()
      }
    })

    localServer.start()
  }
}
