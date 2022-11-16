import { Autowired, BodyParam, Controller, Get, Post, QueryParam } from 'lynx-express-mvc'
import { IOT } from '../../common/iot.models'
import IOTDeviceMgrService from '../service/iot.deviceMgr.service'


@Controller('/iot')
export class IOTMgrController {

  @Autowired()
  iotMgrService: IOTDeviceMgrService

  @Get('/search')
  async search(@QueryParam('keyword') keyword: string) {
    return await this.iotMgrService.searchDevices(keyword)
  }

  @Post('/updateInfo')
  async updateInfo(@BodyParam('device') device: IOT.IOTDevice) {
    return await this.iotMgrService.save(device)
  }

  @Get('/deviceInfo')
  async getDeviceInfo(@QueryParam('deviceId') deviceId: string) {
    return await this.iotMgrService.getDevice(deviceId)
  }

  @Post('/removeDevice')
  async removeDevice(@QueryParam('deviceId') deviceId: string) {
    return await this.iotMgrService.delete(deviceId)
  }


}