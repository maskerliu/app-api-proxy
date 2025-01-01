export namespace Mapi {

  export interface UserInfo {
    uid?: string
    username: string
    password?: string
    email?: string
    phone?: string
    address?: string
  }

  export interface Shop {
    sid: string
    name: string
    address: string
    phone: string
    email: string
    desc: string
  }
}