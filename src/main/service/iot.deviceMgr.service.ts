import { app } from 'electron'
import { Autowired, Service } from 'lynx-express-mvc'
import { connect, IClientOptions, MqttClient } from 'mqtt'
import path from 'path'
import PouchDB from 'pouchdb-node'
import PouchDBFind from 'pouchdb-find'
import { IOT } from '../../common/iot.models'
import { Lynx_Mqtt_Broker } from '../common/Const'
import CommonService from './common.service'

@Service()
export default class IOTDeviceMgrService {

  @Autowired()
  commonService: CommonService

  private localDB: PouchDB.Database
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
    this.initDB()
    this.initMqttClient()
  }

  private async initDB() {
    PouchDB.plugin(PouchDBFind)
    this.localDB = new PouchDB(path.join(app.getPath('userData'), 'IOT.Devices'))
    try {
      await this.localDB.createIndex({ index: { fields: ['deviceId'] }, })
    } catch (err) {
      console.error('initDB', err)
    }
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
          deviceId: msg.from,
          status: msg.type <= IOT.MsgType.REGISTER ? IOT.DeviceStatus.Online : IOT.DeviceStatus.Offline,
          lat: 31.2422,
          lng: 121.3232
        }
        await this.update(device)
      } catch (err) {
        console.log('handleMsg', err)
      }
    })
  }

  public async searchDevices(keyword: string) {

    let request: PouchDB.Find.FindRequest<IOT.IOTDevice> = {
      selector: {
        _id: { $ne: /_design\/idx/ }
      },
      limit: 4,
      fields: ['_id', 'deviceId', 'address', 'lat', 'lng'],
    }
    if (keyword != null && keyword != undefined) {
      request.selector['deviceId'] = { $regex: new RegExp(`${keyword}`) }
    }

    let devices = new Array<IOT.IOTDevice>()
    try {
      let result = await this.localDB.find(request)

      result.docs.forEach(it => {
        let device = it as unknown as IOT.IOTDevice
        devices.push(device)
      })
    } catch (err) {
      throw '服务查询失败' + err
    } finally {
      return devices
    }
  }

  public async getDevice(deviceId: string) {
    let device: IOT.IOTDevice
    try {
      let request: PouchDB.Find.FindRequest<IOT.IOTDevice> = {
        selector: {
          _id: { $ne: /_design\/idx/ },
          deviceId: { $eq: deviceId }
        },
        limit: 15,
        fields: ['_id', '_rev', 'deviceId', 'address', 'lat', 'lng']
      }

      let result = await this.localDB.find(request)
      if (result.docs) {
        device = result.docs[0] as unknown as IOT.IOTDevice
        device.lat = device.lat ? device.lat : 31.2422
        device.lng = device.lng ? device.lng : 121.3232
      }
    } catch (err) {
      throw '查询失败' + err
    } finally {
      return device
    }
  }

  public async update(device: IOT.IOTDevice) {
    let deviceId: string = null
    try {
      let getResult = await this.getDevice(device.deviceId)
      let result = null
      if (getResult) {
        device._rev = getResult._rev
        result = await this.localDB.put(device)
      } else {
        result = await this.localDB.post(device)
      }
      if (result.ok) deviceId = result.id
    } catch (err) {
      throw '更新失败' + err
    } finally {
      return deviceId
    }
  }

  public async delete(deviceId: string) {
    let result = false
    try {
      let device = await this.getDevice(deviceId)
      let removeResult = await this.localDB.remove(device._id, device._rev)
      result = removeResult.ok
    } catch (err) {
      throw '删除失败' + err
    } finally {
      return result
    }

  }

}