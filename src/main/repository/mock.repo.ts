import { Repository } from 'lynx-express-mvc'
import { ProxyMock } from '../../common/proxy.models'
import { USER_DATA_DIR } from '../common/Const'
import BaseRepo from './base.repo'

@Repository(USER_DATA_DIR + '/biz_storage', 'Mock.Rules', ['name'])
export default class MockRepo extends BaseRepo<ProxyMock.MockRule> {

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