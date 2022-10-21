import fs from 'fs'
import path from 'path'
import 'reflect-metadata'
import { fileURLToPath } from 'url'


export const __BaseRoute = Symbol.for('base_route')
export const __RouteMap = Symbol.for('route_map')
export const __MethodParamsMap = Symbol.for('method_params_map')
export const __Controllers = Symbol.for('controllers')

type ParamInfo = {
  name: string,
  type: number, // 0: query param, 1: body param
}


const JSONBigInt = require('json-bigint')

function doScan(floder: string, target: any) {
  let curPath = path.parse(fileURLToPath(import.meta.url)).dir
  let basePath = path.join(path.resolve(), 'src/main', floder)
  let relativePath = path.relative(curPath, basePath)
  console.log(path.relative(curPath, path.join(path.resolve(), 'src/main')))
  if (!Reflect.has(target.prototype, __Controllers)) Reflect.set(target.prototype, __Controllers, new Array())
  fs.readdir(basePath, (err, files) => {
    files.forEach(it => {
      try {
        let moduleName = it.substring(0, it.length - 3)
        let destPath = path.join(relativePath, moduleName)
        destPath = destPath.substring(6, destPath.length)
        const CtrlClasss = require(`../../${destPath}`)
        let ctrls: Array<any> = Reflect.get(target.prototype, __Controllers)
        ctrls.push(new CtrlClasss['default']())
      } catch (err) {
        console.error('[controller]', 'scan', err)
      }
    })
  })
}

function Scan(...args: any): ClassDecorator {
  return (target: Function) => {
    args.forEach((folder: string) => { doScan(folder, target) })
  }
}

function Controller(path?: string): ClassDecorator {
  return (target: Function) => {
    Reflect.set(target.prototype, __BaseRoute, path)
    if (path && Reflect.has(target.prototype, __RouteMap)) {
      let routeMap = new Map()
      Reflect.get(target.prototype, __RouteMap).forEach((val: string, key: string) => {
        routeMap.set(path + key, val)
      })
      Reflect.set(target.prototype, __RouteMap, routeMap)
    }
  }
}

function Service(name?: string): ClassDecorator {
  return (target: Function) => { }
}

function genRouter(target: any, propertyKey: string, path: string) {
  let routeMap = Reflect.has(target, __RouteMap) ? Reflect.get(target, __RouteMap) : new Map()
  routeMap.set(path, propertyKey)
  Reflect.set(target, __RouteMap, routeMap)
}

function makeResponse(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const func = descriptor.value

  // TODO: can add type verify here
  // type ArrType = Parameters<typeof func>
  // type SecondParam = ArrType[0]
  // let params: ArrType = []
  // type IdxParamType = ArrType[0]

  if (!Reflect.has(target, __MethodParamsMap)) return

  let methodParamMap = target[__MethodParamsMap].get(propertyKey) as Map<number, ParamInfo>

  descriptor.value = async (...args: any) => {
    const [req, resp] = args

    if (target[__MethodParamsMap].has(propertyKey)) {
      let arr = new Array<any>()
      methodParamMap.forEach((info, key: number) => {
        let arg: string
        if (info.type == 0) {
          arg = req.query[info.name]
        } else {
          arg = JSONBigInt.parse(req.body)
        }
        arr[key] = arg
        console.error(`index: ${key}, name: ${info.name}, value: ${arg}`)
      })
      let result = await func(...arr)
      resp.json(result)
      resp.end()
      return result
    } else {
      let result = await func(req, resp)
      resp.json(result)
      resp.end()
      return result
    }
  }
}

function genParamMap(target: any, methodKey: string | symbol, parameterIndex: number, name: string, type: number) {
  let methodParamMap = Reflect.has(target, __MethodParamsMap) ? Reflect.get(target, __MethodParamsMap) : new Map()
  let methodInfo: Map<number, ParamInfo> = methodParamMap.has(methodKey) ? methodParamMap.get(methodKey) : new Map()
  methodInfo.set(parameterIndex, { name: name, type: type })
  methodParamMap.set(methodKey, methodInfo)
  Reflect.set(target, __MethodParamsMap, methodParamMap)
}

function QueryParam(name: string): ParameterDecorator {
  return (target: any, methodKey: string | symbol, parameterIndex: number) => {
    genParamMap(target, methodKey, parameterIndex, name, 0)
  }
}

function BodyParam(name?: string): ParameterDecorator {
  return (target: any, methodKey: string | symbol, parameterIndex: number) => {
    genParamMap(target, methodKey, parameterIndex, name, 1)
  }
}

function Get(url: string, desc?: string): MethodDecorator {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    genRouter(target, propertyKey, url)
    makeResponse(target, propertyKey, descriptor)
  }
}

function Post(url: string): MethodDecorator {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    genRouter(target, propertyKey, url)
    makeResponse(target, propertyKey, descriptor)
  }
}

function All(url: string): MethodDecorator {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    genRouter(target, propertyKey, url)
    makeResponse(target, propertyKey, descriptor)
  }
}


export { Scan, Controller, Service, Get, Post, All, QueryParam, BodyParam }
