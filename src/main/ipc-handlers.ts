import { spawn } from 'child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fse from 'fs-extra'
import os from 'os'
import path from 'path'
import type { Version } from '@shared/base.models'
import { MAIN_API_CMD, SaveFileResult } from '@shared/ipc.api'
import { cancelUpdate, runUpdate } from './update.runner'
import { USER_DATA_DIR } from './constants'
import { getAppWindow } from './misc/utils'

ipcMain.handle(MAIN_API_CMD.Relaunch, (_) => {
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

ipcMain.handle(MAIN_API_CMD.SelectFile, async (): Promise<string | undefined> => {
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

ipcMain.handle(MAIN_API_CMD.SelectFolder, async (): Promise<string | undefined> => {
  let result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ['openDirectory',],
  })

  if (result.canceled || result.filePaths.length === 0) return undefined
  return os.platform() == 'darwin' ? `file://${result.filePaths[0]}` : result.filePaths[0]
})

ipcMain.handle(MAIN_API_CMD.OpenFolder, async (_, target: string) => {
  if (!target) return
  await shell.openPath(target)
})

ipcMain.handle(MAIN_API_CMD.WriteClipboard, (_, text: string) => {
  clipboard.writeText(String(text ?? ''))
})

// 落盘结果必须回到调用方：写失败原先只 console.log，渲染层照样提示「导出成功」；
// 而取消不是失败，混在一起会让「取消」弹成错误。
ipcMain.handle(MAIN_API_CMD.SaveFileAs, async (_, title: string, fileName: string, data: string | ArrayBuffer, silent = false): Promise<SaveFileResult> => {
  const defaultPath = path.join(USER_DATA_DIR, fileName)
  const buf = Buffer.from(data as any)

  try {
    await fse.ensureDir(path.dirname(defaultPath))

    if (silent) {
      await fse.writeFile(defaultPath, buf)
      return { status: 'saved', filePath: defaultPath }
    }

    let filters = [{ name: '全部文件', extensions: ['*'] }]
    let ext = path.extname(fileName)
    if (ext && ext !== '.') {
      const name = ext.slice(1, ext.length)
      // 空 name 在系统保存面板里是一行没有标签的过滤器，用户看不出它只匹配 .json/.har
      if (name) {
        filters.unshift({ name: `${name.toUpperCase()} (${ext})`, extensions: [name] })
      }
    }

    const options = { title, filters, defaultPath }
    const win = BrowserWindow.getFocusedWindow()
    // showSaveDialog 的窗口参数不接受 null：没有焦点窗口时改用无父窗口那个重载
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { status: 'canceled' }

    await fse.writeFile(result.filePath, buf)
    return { status: 'saved', filePath: result.filePath }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle(MAIN_API_CMD.OpenDevTools, (_, args?: any) => {
  getAppWindow()?.webContents.openDevTools({ mode: 'detach', activate: false })
})

ipcMain.handle(MAIN_API_CMD.SetAppTheme, (_, theme: ('system' | 'light' | 'dark')) => {
  nativeTheme.themeSource = theme
  const win = getAppWindow()
  if (!win) return
  if (os.platform() == 'darwin') {
    // console.log(this.mainWindow.setTitleBarOverlay)
  } else {
    win.setTitleBarOverlay({
      color: '#f8f8f800',
      symbolColor: nativeTheme.shouldUseDarkColors ? 'white' : 'black'
    })
  }
  win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#f2f3f5')
})

ipcMain.handle(MAIN_API_CMD.DownloadUpdate, async (_, newVersion: Version) => {
  await runUpdate(newVersion)
})

ipcMain.handle(MAIN_API_CMD.CancelUpdate, () => {
  cancelUpdate()
})
