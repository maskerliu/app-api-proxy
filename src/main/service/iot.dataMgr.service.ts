import { app } from 'electron'
import { Service } from 'lynx-express-mvc'
import path from 'path'
import PouchDB from 'pouchdb-node'
import PouchDBFind from 'pouchdb-find'

@Service()
export default class IOTDataService {

  private localDB: PouchDB.Database

  private async initDB() {
    PouchDB.plugin(PouchDBFind)
    this.localDB = new PouchDB(path.join(app.getPath('userData'), 'IOT.Data'))
    try {
      await this.localDB.createIndex({ index: { fields: ['deviceId'] }, })
    } catch (err) {
      console.error('initDB', err)
    }
  }
}