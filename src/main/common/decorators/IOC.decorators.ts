import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { __Controllers, __PropertyMap } from './webmvc.decorators'


type Constructor<T = any> = new (...args: any[]) => T

class Container {
  bindTags = {}

  bind<T>(tag: string | symbol) {
    return {
      to: (target: Constructor<T>) => { this.bindTags[tag] = target }
    }
  }

  get<T>(tag: string | symbol) {
    const target = this.bindTags[tag]
    const providers = []
    for (let i = 0; i < target.length; ++i) {
      const paramTypes = Reflect.getMetadata('custom:paramtypes#' + i, target)
      const provider = this.bindTags[paramTypes.value]
      providers.push(provider)
    }
    return new target(...providers.map(it => new it()))
  }
}

function doScan(floder: string, target: any) {
  let curPath = path.parse(fileURLToPath(import.meta.url)).dir
  let basePath = path.join(path.resolve(), 'src/main', floder)
  let relativePath = path.relative(curPath, basePath)
  // console.log(path.relative(curPath, path.join(path.resolve(), 'src/main')))
  if (!Reflect.has(target.prototype, __Controllers)) Reflect.set(target.prototype, __Controllers, new Array())
  fs.readdir(basePath, (err, files) => {
    files.forEach(it => {
      try {
        let moduleName = it.substring(0, it.length - 3)
        let destPath = path.join(relativePath, moduleName)
        destPath = destPath.substring(6, destPath.length)
        const CtrlClasss = require(`../../${destPath}`)
        let ctrls: Array<any> = Reflect.get(target.prototype, __Controllers)
        let ctrl = new CtrlClasss['default']().init()
        ctrls.push(ctrl)
      } catch (err) {
        console.error('[Router]', 'scan', err)
      }
    })
  })
}

function Scan(...args: any): ClassDecorator {
  return (target: Function) => {
    args.forEach((folder: string) => { doScan(folder, target) })
  }
}


function Autowired(name?: string): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {

    let identifier = Reflect.getMetadata('design:type', target, propertyKey)
    Reflect.set(target, propertyKey, identifier)
    let propertyMap: Map<string | symbol, any> = Reflect.has(target, __PropertyMap) ? Reflect.get(target, __PropertyMap) : new Map()

    if (!propertyMap.has(propertyKey)) {
      propertyMap.set(propertyKey, identifier)
    }
    Reflect.set(target, __PropertyMap, propertyMap)
    // console.log('[Autowired]', propertyKey, identifier)
  }
}

export { Autowired }
