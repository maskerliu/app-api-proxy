import path from 'path'
import { app } from 'electron'


export const Lynx_Mqtt_Broker = 'f9cc4cbec7c54744b1448fe4e6bfd274.s2.eu.hivemq.cloud'

export const USER_DATA_DIR = process.platform == 'linux' ? path.resolve() + '/UserData' : app.getPath('userData')