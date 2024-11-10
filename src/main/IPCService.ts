import { IElectronAPI } from '../common/ipc.api'
import { ipcMain, IpcMainEvent } from 'electron'

export class IPCService implements IElectronAPI {


  openFile(...args: any): Promise<void> {

    return null
  }
  
  openGame(...args: any): Promise<void> {

    return null
  }

  onOpenMockRuleMgr(value: any): void {

  }

  onOpenSettings(value: any): void {

  }




  public registerHandler() {
    ipcMain.handle('openGame', (envent: IpcMainEvent, args?: any) => {
      // this.createGameWindow(args[0])
    })

    ipcMain.handle('updateServerPort', (event: IpcMainEvent, args?: any) => {
      console.log(args)
    })
  }

}