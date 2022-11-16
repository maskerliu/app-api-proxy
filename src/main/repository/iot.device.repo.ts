import { app } from 'electron'
import { Repository } from 'lynx-express-mvc'
import { IOT } from '../../common/iot.models'
import BaseRepo from './base.repo'

@Repository(app.getPath('userData') + '/biz_storage', 'IOT.Devices', ['deviceId'])
export default class IOTDeviceRepo extends BaseRepo<IOT.IOTDevice> {


}