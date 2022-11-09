import { app, BrowserWindow, Menu, nativeImage, session, Tray } from 'electron'
import path from 'path'

import './IPC'
import localServer from "./MainServer"

const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)

export default class MainApp {
  static mainWindow: BrowserWindow = null

  static appTray: Tray = null
  static winURL: string = process.env.NODE_ENV === 'development' ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
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
      show: false,
      titleBarStyle: 'hidden',

      webPreferences: {
        devTools: process.env.NODE_ENV == 'development',
        sandbox: false,
        preload: path.join(__dirname, 'preload.js')
      },
    })

    MainApp.mainWindow.loadURL(MainApp.winURL)
    MainApp.mainWindow.webContents.frameRate = 30
    if (process.env.NODE_ENV == 'development') {
      MainApp.mainWindow.webContents.openDevTools()
    }
    MainApp.mainWindow.on('closed', () => { MainApp.onClose() })

    MainApp.mainWindow.on('ready-to-show', () => {
      MainApp.mainWindow.show()
      MainApp.mainWindow.focus()
    })
  }

  private static createAppMenu() {
    Menu.setApplicationMenu(null)
  }

  static start() {
    if (process.platform === 'win32') {
      app.disableHardwareAcceleration()
    }
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    // app.commandLine.appendSwitch('disable-gpu')
    // app.commandLine.appendSwitch('disable-software-rasterizer')
    app.on('window-all-closed', MainApp.onWindowAllClosed)
    app.on('activate', () => {
      if (MainApp.mainWindow == null) {
        MainApp.createMainWindow()
      }
    })
    app.on('ready', () => {
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


      import('./IPC')

      if (MainApp.mainWindow == null) {
        MainApp.createMainWindow()
        MainApp.createAppMenu()
      }
    })

    localServer.start()
  }
}
