import { spawn } from 'child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fse from 'fs-extra'
import os from 'os'
import path from 'path'
import type { Version } from '@shared/base.models'
import { MainApiCmd } from '@shared/ipc.api'
import { cancelUpdate, runUpdate } from './AppUpdater'
import { USER_DATA_DIR } from './MainConst'
import { getAppWindow } from './misc/utils'

ipcMain.handle(MainApiCmd.Relaunch, (_) => {
  const resourcesUpdate = path.join(process.resourcesPath, 'update.asar')
  const stagedUpdate = path.join(USER_DATA_DIR, 'update', 'update.asar')
  const pending = fse.pathExistsSync(resourcesUpdate) || fse.pathExistsSync(stagedUpdate)

  if (pending && app.isPackaged) {
    const logDir = app.getPath('logs')
    fse.ensureDirSync(logDir)
    const helper = path.join(process.resourcesPath, 'update-helper.cjs')

    if (os.platform() == 'win32' && fse.pathExistsSync(helper)) {
      // Electron 的 Node 模式是 GUI 子系统进程，不会弹出控制台窗口；helper 负责等待进程退出、
      // 替换 app.asar（安装目录不可写时通过 elevate.exe 提权）并重新启动应用
      const child = spawn(process.execPath, [
        helper,
        '--resources', process.resourcesPath,
        '--exe', app.getPath('exe'),
        '--log', path.join(logDir, 'update.log'),
        '--pid', String(process.pid),
        '--staged', stagedUpdate
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
      child.on('error', err => console.error('spawn update helper failed:', err.message))
      child.unref()
    } else if (os.platform() != 'win32') {
      const out = fse.openSync(path.join(logDir, 'out.log'), 'a')
      const err = fse.openSync(path.join(logDir, 'err.log'), 'a')
      const updateSh = `sh ${path.join(process.resourcesPath, 'update.sh')}`
      const child = spawn(
        updateSh,
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
  } else {
    app.relaunch({ execPath: app.isPackaged ? process.execPath : __dirname })
  }
  app.quit()
})

ipcMain.handle(MainApiCmd.SelectFile, async (): Promise<string | undefined> => {
  let result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ['openFile',],
    filters: [
      {
        name: 'Image',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']
      }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) return undefined
  return os.platform() == 'darwin' ? `file://${result.filePaths[0]}` : result.filePaths[0]
})

ipcMain.handle(MainApiCmd.SelectFolder, async (): Promise<string | undefined> => {
  let result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ['openDirectory',],
  })

  if (result.canceled || result.filePaths.length === 0) return undefined
  return os.platform() == 'darwin' ? `file://${result.filePaths[0]}` : result.filePaths[0]
})

ipcMain.handle(MainApiCmd.OpenFolder, async (_, target: string) => {
  if (!target) return
  await shell.openPath(target)
})

ipcMain.handle(MainApiCmd.WriteClipboard, (_, text: string) => {
  clipboard.writeText(String(text ?? ''))
})

ipcMain.handle(MainApiCmd.SaveFileAs, async (_, title: string, fileName: string, data: string | ArrayBuffer, silent = false) => {
  let filePath = path.join(USER_DATA_DIR, fileName)
  await fse.ensureDir(path.dirname(filePath))

  if (silent) {
    await fse.writeFile(filePath, Buffer.from(data as any) as any)
    return
  }

  let filters = [{ name: '全部文件', extensions: ['*'] }]
  let ext = path.extname(fileName)
  if (ext && ext !== '.') {
    const name = ext.slice(1, ext.length)
    if (name) {
      filters.unshift({ name: '', extensions: [name] })
    }
  }

  try {
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
      title,
      filters,
      defaultPath: filePath
    })
    if (result.canceled || !result.filePath) return
    await fse.writeFile(result.filePath, Buffer.from(data as any) as any)
  } catch (e) {
    console.log(`save as--catch:${e}`)
  }
})

ipcMain.handle(MainApiCmd.OpenDevTools, (_, args?: any) => {
  getAppWindow()?.webContents.openDevTools({ mode: 'detach', activate: false })
})

ipcMain.handle(MainApiCmd.SetAppTheme, (_, theme: ('system' | 'light' | 'dark')) => {
  nativeTheme.themeSource = theme
  if (os.platform() == 'darwin') {
    // console.log(this.mainWindow.setTitleBarOverlay)
  } else {
    getAppWindow()?.setTitleBarOverlay({
      color: '#f8f8f800',
      symbolColor: nativeTheme.shouldUseDarkColors ? 'white' : 'black'
    })
  }
})

ipcMain.handle(MainApiCmd.DownloadUpdate, async (_, newVersion: Version) => {
  await runUpdate(newVersion)
})

ipcMain.handle(MainApiCmd.CancelUpdate, () => {
  cancelUpdate()
})
