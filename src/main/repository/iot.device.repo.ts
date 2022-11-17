import { Repository } from 'lynx-express-mvc'
import { IOT } from '../../common/iot.models'
import { USER_DATA_DIR } from '../common/Const'
import BaseRepo from './base.repo'

@Repository(USER_DATA_DIR + '/biz_storage', 'IOT.Devices', ['deviceId'])
export default class IOTDeviceRepo extends BaseRepo<IOT.IOTDevice> {

  public async update(item: IOT.IOTDevice) {
    let resultId: string = null
    try {
      let getResult = await this.get('deviceId', item.deviceId, ['_rev'])
      let result = null
      if (getResult) {
        item._rev = getResult._rev
        result = await this.pouchdb.put(item)
      } else {
        result = await this.pouchdb.post(item)
      }
      if (result.ok) resultId = result.id
    } catch (err) {
      throw '更新失败' + err
    } finally {
      return resultId
    }
  }
}