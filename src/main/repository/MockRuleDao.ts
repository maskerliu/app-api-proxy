import { app } from 'electron'
import path from 'path'
import PouchDB from 'pouchdb'
import PouchDBFind from 'pouchdb-find'
import { Repository } from '../common/decorators/webmvc.decorators'


@Repository(path.join(app.getPath('userData'), 'MockRuleDB'), PouchDB)
export default class MockRuleDao {
  private localDB: PouchDB.Database
  
  constructor() {
    this.initDB()
  }

  private async initDB() {
    PouchDB.plugin(PouchDBFind)
    this.localDB = new PouchDB(path.join(app.getPath('userData'), 'MockRuleDB'))
    try {
      await this.localDB.createIndex({ index: { fields: ['name'] }, })
    } catch (err) {
      console.error('initDB', err)
    }
  }
}