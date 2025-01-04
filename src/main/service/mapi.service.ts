import { injectable } from "inversify"
import "reflect-metadata"
import { BizContext, Mapi } from "../../common"


export interface IMapiService {

  login(username: string, password: string, context: BizContext): String

  logout(token: string): String

  register(username: string, password: string, useInfo: Mapi.UserInfo): String

  getUserInfo(uid: string, context: BizContext): Mapi.UserInfo
}

/**
 * this is a mock service for mapi
 */
@injectable()
export class MapiService implements IMapiService {

  private users: Mapi.UserInfo[] = []

  constructor() {

    this.users.push(
      {
        uid: '1',
        username: 'chris',
        password: '4074e1a91c6066ad5bf4ddefb38c8789',
        email: 'lynx.chrisliu@live.com',
        phone: '13800000000',
        address: 'shanhai china'
      },
      {
        uid: '2',
        username: 'lily',
        password: '0e178059261cd3ad31566c0117c3b456',
        email: 'lynx.lilyli@live.com',
        phone: '17717717777',
        address: 'jiangsu china'
      },
      {
        uid: '3',
        username: 'marry',
        password: '4b79ddfc4440e7307d90dd8541e8a76e',
        email: 'lynx.marryli@live.com',
        phone: '17711776666',
        address: 'zhejiang china'
      }
    )
  }

  login(username: string, password: string, context: BizContext): String {
    return 'token11111'
  }

  logout(token: string): String {
    return 'logout success'
  }

  register(username: string, password: string, userInfo: Mapi.UserInfo): String {
    try {
      // console.log('register', userInfo)
      return 'register success'
    } catch (err) {
      console.error(err)
      throw new Error('register failed')
    }
  }

  getUserInfo(uid: string, context: BizContext): Mapi.UserInfo {
    return {
      username: 'test',
      email: 'lynx.chrisliu@live.com',
      phone: '12345678910',
      address: 'shanghai china'
    }
  }

  private generateToken(username: string): string {
    return 'token11111'
  }
}