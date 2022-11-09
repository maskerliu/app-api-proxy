import { app, dialog, ipcMain, IpcMainEvent } from "electron";

ipcMain.handle("getAppDir", async (event: IpcMainEvent, args?: any) => {
  return app.getPath("userData");
})


ipcMain.handle('openGame', (envent: IpcMainEvent, args?: any) => {
  console.log(args)
})