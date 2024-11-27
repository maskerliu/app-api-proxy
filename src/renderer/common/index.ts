export { PushClient } from './PushClient'

export function generateUid(): string {
  let len = 8
  let res = []
  for (let i = 0; i !== len; ++i) {
    res.push(
      String.fromCharCode(
        Math.floor(Math.random() * 26) + (Math.random() > 0.5 ? 65 : 97)
      )
    )
  }
  res.push(new Date().getTime() + "o")
  return res.join("")
}

export function throttle(fn: Function, delay: number) {
  let timer = null;
  return (...args: any) => {
    if (!timer) {
      timer = setTimeout(() => {
        fn.apply(this, args);
        timer = null;
      }, delay);
    }
  };
}


export function map2json(map: Map<any, any>): JSON {
  let json = Object.create(null)
  for (let [key, value] of map) {
    json[key] = value
  }
  return json
}

export function json2map(obj: JSON): Map<any, any> {
  let map = new Map()
  for (let key of Object.keys(obj)) {
    map.set(key, obj[key])
  }
  return map
}

export function random(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}