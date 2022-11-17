import { Repository } from 'lynx-express-mvc'
import { IOT } from '../../common/iot.models'
import { USER_DATA_DIR } from '../common/Const'
import BaseRepo from './base.repo'

@Repository(USER_DATA_DIR + '/biz_storage', 'IOT.Data', ['deviceId'])
export default class IOTRepo extends BaseRepo<IOT.IOTDevice> {


}