import { Autowired, Controller, Get, Post, QueryParam } from 'lynx-express-mvc'
import { IOT } from '../../common/iot.models'
import { BizCode, BizResponse } from '../../common/base.models'
import IOTDeviceMgrService from '../service/iot.deviceMgr.service'
import { BodyParam } from 'lynx-express-mvc'


@Controller('/iot')
export class IOTMgrController {

  @Autowired()
  iotMgrService: IOTDeviceMgrService

  @Get('/search')
  async search(@QueryParam('keyword') keyword: string) {
    let bizResp: BizResponse<Array<IOT.IOTDevice>>
    try {
      let devices = await this.iotMgrService.searchDevices(keyword)
      bizResp = { code: BizCode.SUCCESS, data: devices }
    } catch (err) {
      bizResp = { code: BizCode.ERROR, message: err as string }
    } finally {
      return bizResp
    }
  }

  @Post('/updateInfo')
  async updateInfo(@BodyParam('device') device: IOT.IOTDevice) {

    let bizResp: BizResponse<string>
    try {
      let result = await this.iotMgrService.update(device)
      bizResp = { code: BizCode.SUCCESS, data: result }
    } catch (err) {
      bizResp = { code: BizCode.ERROR, message: err as string }
    } finally {
      return bizResp
    }
  }

  @Get('/deviceInfo')
  async getDeviceInfo(@QueryParam('deviceId') deviceId: string) {
    let bizResp: BizResponse<IOT.IOTDevice>
    try {
      let device = await this.iotMgrService.getDevice(deviceId)
      bizResp = { code: BizCode.SUCCESS, data: device }
    } catch (err) {
      bizResp = { code: BizCode.ERROR, message: err as string }
    } finally {
      return bizResp
    }
  }

  @Post('/removeDevice')
  async removeDevice(@QueryParam('deviceId') deviceId: string) {
    let bizResp: BizResponse<string>
    try {
      await this.iotMgrService.delete(deviceId)
      bizResp = { code: BizCode.SUCCESS, data: `设备[${deviceId}]已被移除` }
    } catch (err) {
      bizResp = { code: BizCode.ERROR, message: err as string }
    } finally {
      return bizResp
    }
  }


}