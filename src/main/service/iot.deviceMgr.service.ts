import { Autowired, Service } from 'lynx-express-mvc'
import { connect, IClientOptions, MqttClient } from 'mqtt'
import { IOT } from '../../common/iot.models'
import { Lynx_Mqtt_Broker } from '../common/Const'
import IOTDeviceRepo from '../repository/iot.device.repo'
import CommonService from './common.service'

@Service()
export default class IOTDeviceMgrService {

  @Autowired()
  commonService: CommonService

  @Autowired()
  deviceRepo: IOTDeviceRepo

  private client: MqttClient
  private options: IClientOptions = {
    host: '',
    port: 8883,
    protocol: 'mqtts',
    username: 'lynx-iot',
    password: '12345678',
    clientId: 'lynx-iot-server'
  }

  constructor() {
    this.initMqttClient()
  }


  private initMqttClient() {
    this.options.host = Lynx_Mqtt_Broker
    this.client = connect(this.options)

    // set callback handlers
    this.client.on('connect', () => {
      this.client.subscribe('my/test/android')
      this.client.subscribe('my/test/web')
      this.client.subscribe('my/test/nodered')
    })

    this.client.on('error', (error) => { console.log(error) })

    this.client.on('message', async (topic, message) => {
      try {
        let msg = JSON.parse(message.toString()) as IOT.IOTMsg
        let device: IOT.IOTDevice = {
          _id: null,
          _rev: null,
          deviceId: msg.from,
          status: msg.type <= IOT.MsgType.REGISTER ? IOT.DeviceStatus.Online : IOT.DeviceStatus.Offline,
          lat: 31.2422,
          lng: 121.3232
        }
        await this.deviceRepo.update(device)
      } catch (err) {
        console.log('handleMsg', err)
      }
    })
  }

  public async searchDevices(keyword: string) {
    return await this.deviceRepo.search('deviceId', keyword, ['_id', 'deviceId', 'address', 'lat', 'lng'])
  }

  public async getDevice(deviceId: string) {
    let device: IOT.IOTDevice
    try {
      let result = await this.deviceRepo.get('deviceId', deviceId, ['_id', '_rev', 'deviceId', 'address', 'lat', 'lng'])
      result.lat = result.lat ? result.lat : 31.2422
      result.lng = result.lng ? result.lng : 121.3232
    } catch (err) {
      throw '查询失败' + err
    } finally {
      return device
    }
  }

  public async save(device: IOT.IOTDevice) {
    return await this.deviceRepo.update(device)
  }

  public async delete(deviceId: string) {
    let device = await this.deviceRepo.get('deviceId', deviceId)
    let result = await this.deviceRepo.delete(device._id)
    if (result)
      return `设备[${deviceId}]已被移除`
    else
      return `设备[${deviceId}]移除失败`
  }

}