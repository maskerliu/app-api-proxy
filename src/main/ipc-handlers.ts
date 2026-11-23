import { spawn } from 'child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fse from 'fs-extra'
import os from 'os'
import path from 'path'
import type { Version } from '@shared/base.models'
import type {
  MockPackExportOptions, MockPackImportOptions, MockPackPreviewOptions,
} from '@shared/mock.pack'
import { MockError } from '@shared/mock.errors'
import { MAIN_API_CMD, MainCallResult, SaveFileResult, SaveMockPackResult, SelectSavePathResult } from '@shared/ipc.api'
import { bizContainer } from './IocContainer'
import { IOC_TYPES, USER_DATA_DIR } from './constants'
import type { MockPackService } from './service/mock.pack.service'
import type { MockShareService } from './service/mock.share.service'
import { cancelUpdate, runUpdate } from './update.runner'
import { getAppWindow } from './misc/utils'
import { saveDialogOptions, toSaveFileName } from './misc/save-path'

// showSaveDialog 的窗口参数不接受 null：没有焦点窗口时改用无父窗口那个重载
async function showSaveDialog(options: ReturnType<typeof saveDialogOptions>) {
  const win = BrowserWindow.getFocusedWindow()
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}

/**
 * 异常跨 IPC 只剩 `message`，而界面文案是按 `MockError.code` 取的（C5「不许统一成一句」）——
 * 所以这一层负责把码与 detail 摊平成载荷，而不是让它作为一个 reject 出去。
 * 取消单独占一档：它是用户按的，混进 failed 就会在取消之后弹一句错误（同 `SaveFileResult` 的理由）。
 * 认不出码的那些不替它编一个远端码——那句确实是没预料到的错。
 */
async function shareCall<T>(run: () => Promise<T>): Promise<MainCallResult<T>> {
  try {
    return { status: 'ok', data: await run() }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { status: 'canceled' }
    if (err instanceof MockError) {
      return err.detail == null ? { status: 'failed', code: err.code } : { status: 'failed', code: err.code, detail: err.detail }
    }
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) }
  }
}

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
  // 名字先剥成最后一段再拼：`silent` 那一档不经对话框直接写盘，带 `../` 的名字等于让渲染层自己挑目录
  const safeName = toSaveFileName(fileName)
  if (safeName === '') return { status: 'failed', error: 'invalid file name' }
  const defaultPath = path.join(USER_DATA_DIR, safeName)
  const buf = Buffer.from(data as any)

  try {
    await fse.ensureDir(path.dirname(defaultPath))

    if (silent) {
      await fse.writeFile(defaultPath, buf)
      return { status: 'saved', filePath: defaultPath }
    }

    const result = await showSaveDialog(saveDialogOptions(title, USER_DATA_DIR, safeName))
    if (result.canceled || !result.filePath) return { status: 'canceled' }

    await fse.writeFile(result.filePath, buf)
    return { status: 'saved', filePath: result.filePath }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
})

// 导出这类「数据由主进程产生」的落盘要拆成两步：先只拿路径，再让主进程边拼边写目标文件。
// 合成一步就得把整包文本经 structured clone 交给渲染进程再交回来，内存峰值下界仍是包体积。
ipcMain.handle(MAIN_API_CMD.SelectSavePath, async (_, title: string, fileName: string): Promise<SelectSavePathResult> => {
  const result = await showSaveDialog(saveDialogOptions(title, USER_DATA_DIR, fileName))
  if (result.canceled || !result.filePath) return { status: 'canceled' }
  return { status: 'selected', filePath: result.filePath }
})

ipcMain.handle(MAIN_API_CMD.ExportMockPack, async (_, filePath: string, options: MockPackExportOptions): Promise<SaveMockPackResult> => {
  if (!filePath) return { status: 'failed', error: 'missing target path' }
  try {
    // 进度按场景推：一个场景一次，最多几十条消息，不值得再合并节流
    const meta = await bizContainer.get<MockPackService>(IOC_TYPES.MockPackService)
      .exportToFile(filePath, options, (progress) => getAppWindow()?.webContents.send(MAIN_API_CMD.ExportPackProgress, progress))
    return { status: 'saved', filePath, ...meta }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
})

// 云共享（v1.3 Phase A）走主进程直调，不进 8884 那两个 multipart 端点：那边收的是文件，
// 而这里要回的是一句「远端此刻答了什么」——错误码与阶段是内容本身，不是日志。
ipcMain.handle(MAIN_API_CMD.MockShareCheck, () =>
  shareCall(() => bizContainer.get<MockShareService>(IOC_TYPES.MockShareService).check()))

ipcMain.handle(MAIN_API_CMD.MockShareEstimate, () =>
  shareCall(() => bizContainer.get<MockShareService>(IOC_TYPES.MockShareService).estimate()))

ipcMain.handle(MAIN_API_CMD.MockShareBackup, () => shareCall(() =>
  // 进度按场景推，与导出同一形态：一个场景一次，最多几十条消息，不值得再合并节流
  bizContainer.get<MockShareService>(IOC_TYPES.MockShareService)
    .backup((progress) => getAppWindow()?.webContents.send(MAIN_API_CMD.MockShareProgress, progress))))

ipcMain.handle(MAIN_API_CMD.MockShareCancel, () =>
  bizContainer.get<MockShareService>(IOC_TYPES.MockShareService).cancel())

ipcMain.handle(MAIN_API_CMD.MockShareOverview, () =>
  shareCall(() => bizContainer.get<MockShareService>(IOC_TYPES.MockShareService).overview()))

ipcMain.handle(MAIN_API_CMD.MockSharePreview, (_, keys: string[], options: MockPackPreviewOptions) =>
  shareCall(() => bizContainer.get<MockShareService>(IOC_TYPES.MockShareService).preview(keys, options)))

ipcMain.handle(MAIN_API_CMD.MockShareImport, (_, keys: string[], options: MockPackImportOptions) =>
  shareCall(() => bizContainer.get<MockShareService>(IOC_TYPES.MockShareService).import(keys, options)))

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
