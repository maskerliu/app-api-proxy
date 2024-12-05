import { get } from './base.api'


export namespace VirtualClient {



}

export function test(keyword: string) {
  return get<any>('/virtualclient/test', null, { keyword })
}