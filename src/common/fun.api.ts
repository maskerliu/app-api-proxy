import { formPost, get, post } from './base.api'
import { Fun } from './fun.models'

export function searchGames(keyword: string) {
  return get<Array<Fun.GameItem>>('/fun/game/search', null, { keyword })
}


export function uploadGameResource(data: FormData) {
  return formPost('/fun/game/upload', null, null, data)
}