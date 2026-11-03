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
  if (fse.pathExistsSync(path.join(process.resourcesPath, 'update.asar'))) {
    const logPath = app.getPath('logs')
    const out = fse.openSync(path.join(logPath, 'out.log'), 'a')
    const err = fse.openSync(path.join(logPath, 'err.log'), 'a')

    if (os.platform() == 'win32') {
      const helper = path.join(process.resourcesPath, 'update.ps1')
      // 直接 detached 启动控制台程序时 PowerShell 会立即退出而不执行脚本，需经 shell 转发
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
          `"${helper}"`, `"${process.resourcesPath}"`, `"${app.getPath('exe')}"`, `"${path.join(logPath, 'err.log')}"`],
        {
          detached: true,
          shell: true,
          stdio: ['ignore', out, err],
          windowsHide: true
        })
      child.unref()
    } else {
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

ipcMain.handle(MainApiCmd.SaveFileAs, async (_, title: string, fileName: string, data: string | ArrayBuffer, slient = false) => {
  let filePath = path.join(USER_DATA_DIR, fileName)
  await fse.ensureDir(path.dirname(filePath))

  if (slient) {
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
