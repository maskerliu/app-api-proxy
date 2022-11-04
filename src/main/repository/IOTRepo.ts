import { app } from 'electron'
import path from 'path'
import PouchDB from 'pouchdb'
import PouchDBFind from 'pouchdb-find'
import { Repository } from '../common/decorators/webmvc.decorators'

@Repository(path.join(app.getPath('userData'), 'IOTDevice'), PouchDB)
export default class IOTRepo {

  private localDB: PouchDB.Database
  
  constructor() {
    this.initDB()
  }

  private async initDB() {
    
  }


}