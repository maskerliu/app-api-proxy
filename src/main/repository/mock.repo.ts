
import { Injectable } from '@nestjs/common'
import path from 'path'
import PouchFind from 'pouchdb-find'
import PouchDB from 'pouchdb-node'
import { ProxyMock } from '../../common/proxy.models'
import { USER_DATA_DIR } from '../common/Const'
import BaseRepo from './base.repo'

PouchDB.plugin(PouchFind)

// @Repository(USER_DATA_DIR + '/biz_storage', 'Mock.Rules', ['name'])
@Injectable()
export class MockRepo extends BaseRepo<ProxyMock.MockRule> {

  constructor() {
    super()
    this.pouchdb = new PouchDB(path.join(USER_DATA_DIR + '/biz_storage', 'Mock.Rules', 'name'))
  }

  public async save(rule: ProxyMock.MockRule, onlySnap: boolean) {
    let resp: PouchDB.Core.Response
    if (rule._id === null || rule._id === undefined) {
      resp = await this.pouchdb.post(rule)
    } else {
      let getResult = await this.pouchdb.get<ProxyMock.MockRule>(rule._id)
      rule._rev = getResult._rev
      if (onlySnap) rule.requests = getResult.requests
      resp = await this.pouchdb.put(rule)
    }
    return resp.id
  }


}