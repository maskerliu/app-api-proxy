import { injectable, interfaces } from "inversify"
import path from 'path'
import PouchFind from 'pouchdb-find'
import PouchDB from 'pouchdb-node'
import { ProxyMock } from '../../common/proxy.models'
import { USER_DATA_DIR } from '../MainConst'
import BaseRepo from './base.repo'
import "reflect-metadata"

PouchDB.plugin(PouchFind)

export interface IMockRepo {
  search(field?: string, query?: string, returnFields?: Array<string>): Promise<ProxyMock.MockRule[]>
  find(request: PouchDB.Find.FindRequest<ProxyMock.MockRule>): Promise<ProxyMock.MockRule[]>
  get(field: string, query: string, returnFields?: Array<string>): Promise<ProxyMock.MockRule>
  update(item: ProxyMock.MockRule): Promise<string>
  delete(id: string): Promise<boolean>
  save(rule: ProxyMock.MockRule, onlySnap: boolean): Promise<string>
}

// @Repository(USER_DATA_DIR + '/biz_storage', 'Mock.Rules', ['name'])
@injectable()
export class MockRepo extends BaseRepo<ProxyMock.MockRule> implements IMockRepo {

  constructor() {
    super()
    this.pouchdb = new PouchDB(path.join(USER_DATA_DIR + '/biz_storage', 'Mock.Rules'))
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