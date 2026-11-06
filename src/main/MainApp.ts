import { exec } from 'child_process'
import {
  app, BrowserWindow, BrowserWindowConstructorOptions,
  globalShortcut, ipcMain, Menu, session, Tray
} from 'electron'
import fs from 'original-fs'
import os from 'os'
import path from 'path'
import { MainApiCmd } from '@shared/ipc.api'
import './IPCServices'
import { AppName, IS_DEV, USER_DATA_DIR } from './MainConst'
import { MainServer } from './MainServer'

const BUILD_CONFIG = JSON.parse(process.env.BUILD_CONFIG)

const VUE_PLUGIN = os.platform() == 'darwin' ? '/Users/chris/Downloads/vue-devtools/7.6.8_0' : 'D:/vue-devtools/7.6.5_0'

export default class MainApp {
  private mainWindow: BrowserWindow = null
  private tray: Tray = null
  private winURL: string = IS_DEV ? `${BUILD_CONFIG.protocol}://localhost:9080` : `file://${__dirname}/index.html`
  private staticDir: string
  private dockerIconFile: string
  private mainServer: MainServer = new MainServer()

  constructor() {
    this.staticDir = path.join(__dirname, IS_DEV ? '../../icons' : './static')
    let ext = os.platform() == 'win32' ? 'ico' : 'png'
    this.dockerIconFile = path.join(this.staticDir, `icon.${ext}`)
    this.mainServer.bootstrap()
  }

  public async startApp() {
    if (!app.requestSingleInstanceLock()) {
      app.quit()
      return
    }

    app.setName(AppName)
    app.setPath('crashDumps', path.join(USER_DATA_DIR, 'crashDumps'))
    // app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    app.commandLine.appendSwitch('disable-software-rasterizer')

    if (IS_DEV) {
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

    app.on('ready', async () => {
      globalShortcut.register('CommandOrControl+q', () => {
        app.quit()
      })

      globalShortcut.register('CommandOrControl+r', () => {
        BrowserWindow.getFocusedWindow()?.reload()
      })

      this.initSessionConfig()
      await this.initIPCService()

      if (this.mainWindow == null) {
        this.createMainWindow()
      }

      this.addFirewallRule()
      this.createTrayMenu()
    })

    app.on('second-instance', (_, args, workDir) => {
      console.log(args, workDir)
      if (this.mainWindow == null) this.createMainWindow()
      this.mainWindow?.show()
      this.mainWindow?.focus()
    })

    app.on('before-quit', () => {
      app.releaseSingleInstanceLock()
      this.mainServer.stop().catch(err => console.error(err))
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
      backgroundColor: '#f2f3f5',
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

    this.mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
      console.error('preload error', preloadPath, error)
    })

    this.mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[FATAL] render-process-gone:', details.reason, details.exitCode)
    })

    this.mainWindow.webContents.on('unresponsive', () => {
      console.error('[FATAL] renderer unresponsive')
    })

    this.mainWindow.on('ready-to-show', () => {
      this.mainWindow.show()
      this.mainWindow.focus()
      if (IS_DEV) this.mainWindow.webContents.openDevTools({ mode: 'detach', activate: false })
    })
  }

  private createTrayMenu() {

    let iconDir = IS_DEV ? path.join(this.staticDir, 'common') : this.staticDir
    this.tray = new Tray(path.join(iconDir, 'icon-tray.png'))
    const contextMenu = Menu.buildFromTemplate([
      {
        icon: path.join(iconDir, 'ic-rule.png'),
        label: '用例管理',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(MainApiCmd.OpenMockRuleMgr)
        }
      },
      {
        icon: path.join(iconDir, 'ic-setting.png'),
        label: '设置',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(MainApiCmd.OpenSettings)
        }
      },
      {
        icon: path.join(iconDir, 'ic-rule.png'),
        label: '接入向导',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(MainApiCmd.OpenOnboarding)
        }
      },
      {
        icon: path.join(iconDir, 'ic-debug.png'),
        label: '开发者面板',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.webContents.send(MainApiCmd.OpenDevTools)
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

    this.tray.on('click', () => {
      if (this.mainWindow == null) {
        this.createMainWindow()
      } else {
        this.mainWindow.show()
        this.mainWindow.focus()
      }
    })

    this.tray.setToolTip(AppName)
    this.tray.setContextMenu(contextMenu)
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

    if (IS_DEV && os.platform() != 'linux' && fs.existsSync(VUE_PLUGIN)) {
      session.defaultSession.extensions.loadExtension(VUE_PLUGIN)
        .catch(err => console.warn('load vue devtools failed:', err.message))
    }

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.indexOf('.amap.com') !== -1
        || details.url.indexOf('alicdn.com') !== -1
        || details.url.indexOf('qcloud.com') !== -1) {
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

  private async initIPCService() {
    ipcMain.handle(MainApiCmd.GetBizConfig, () => this.mainServer.getBizConfig())

    ipcMain.handle(MainApiCmd.UpdateBizConfig, async (_, configJson: string) => {
      const config = JSON.parse(configJson)
      await this.mainServer.updateBizConfig(config)
      return this.mainServer.getBizConfig()
    })

    ipcMain.handle(MainApiCmd.SendServerEvent, () => {
      // console.log('send sse')
    })
  }

  private addFirewallRule() {
    if (os.platform() !== 'win32') return

    const appPath = process.execPath
    const ruleName = IS_DEV ? 'Electron' : AppName
    const checkCommand = `netsh advfirewall firewall show rule name="${ruleName}"`

    exec(checkCommand, (error, stdout) => {
      if (stdout?.includes('No rules match') || stdout?.includes('没有与指定标准相匹配的规则')) {
        const ruleCommand = (dir: 'in' | 'out') =>
          `netsh advfirewall firewall add rule name="${ruleName}" dir=${dir} action=allow program="${appPath}" enable=yes`

        exec(ruleCommand('in'), (err) => {
          if (err) console.error(`inbound rule add failed: ${err.message}`)
          else console.log('inbound rule added')
        })
        exec(ruleCommand('out'), (err) => {
          if (err) console.error(`outbound rule add failed: ${err.message}`)
          else console.log('outbound rule added')
        })
      } else {
        console.log('firewall rule exists')
      }
    })
  }
}
