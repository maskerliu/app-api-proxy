import 'reflect-metadata'

export const __BaseRoute = Symbol.for('base_route')
export const __RouteMap = Symbol.for('route_map')
export const __MethodParamsMap = Symbol.for('method_params_map')
export const __Controllers = Symbol.for('controllers')
export const __PropertyMap = Symbol.for('property_info_map')

const __IOC_Container: Map<string, Object> = new Map()

const __IOC_Controller_Map: Map<string, any> = new Map()

type ControllerInfo = {
  router: Map<string, string>,
  constructor: any
}

type ParamInfo = {
  name: string,
  type: number, // 0: query param, 1: body param
}

const JSONBigInt = require('json-bigint')


function Router() {
  return <T extends { new(...args: any[]): {} }>(constructor: T) => {
    return class extends constructor {
      init() {
        if (this[__Controllers] == null) this[__Controllers] = new Array()
        __IOC_Controller_Map.forEach((func, key) => {
          this[__Controllers].push(new func().init())
          console.log("[Router]", key, func)
        })
        return this
      }
    }
  }
}

function Route(): MethodDecorator {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    descriptor.value = function (this: any, ...args: any) {
      let [req] = args
      let canHandle = false
      let ctrls = this[__Controllers]
      for (let i = 0; i < ctrls.length; ++i) {
        let ctrl = ctrls[i]
        let routeMap = Reflect.get(ctrl, __RouteMap) as Map<string, string>

        if (routeMap.has(req.path)) {
          let func = Reflect.get(ctrl, routeMap.get(req.path))
          Reflect.apply(func, ctrl, args)
          canHandle = true
          break
        }
      }
      return canHandle
    }
  }
}

function _genConstructor<T extends { new(...args: any[]): {} }>(constructor: T) {

  return class extends constructor {
    init() {
      if (Reflect.has(constructor.prototype, __PropertyMap)) {
        let propertyMap = Reflect.get(constructor.prototype, __PropertyMap)
        for (let key of propertyMap.keys()) {
          let ClassDefined = propertyMap.get(key)
          if (!__IOC_Container.has(key)) {
            let instance = new ClassDefined()
            try { instance.init() } catch (err) { }
            __IOC_Container.set(key, instance)
            // console.log('[constructor]', `[${constructor.name}] add new instance of\t\t`, ClassDefined)
          } else {
            // console.log('[constructor]', `[${constructor.name}] get existed instance of\t\t`, ClassDefined)
          }
          this[key] = __IOC_Container.get(key)
        }
      }
      return this
    }
  }
}

function Component(name?: string) {
  return <T extends { new(...args: any[]): {} }>(constructor: T) => {
    return _genConstructor(constructor)
  }
}

function Controller(path?: string) {
  return <T extends { new(...args: any[]): {} }>(constructor: T) => {
    let newConstructor = _genConstructor(constructor)
    if (path && Reflect.has(constructor.prototype, __RouteMap)) {
      let routeMap = new Map()
      Reflect.get(constructor.prototype, __RouteMap).forEach((val: string, key: string) => {
        routeMap.set(path + key, val)
      })
      Reflect.set(constructor.prototype, __RouteMap, routeMap)

      __IOC_Controller_Map.set(constructor.name, newConstructor)
    }
    console.log(__IOC_Controller_Map)
    return newConstructor
  }
}

function Service(name?: string) {
  return Component(name)
}

function _genMethodRouter(target: any, propertyKey: string, path: string) {
  let routeMap = Reflect.has(target, __RouteMap) ? Reflect.get(target, __RouteMap) : new Map()
  routeMap.set(path, propertyKey)
  Reflect.set(target, __RouteMap, routeMap)
}

function _makeResponse(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const func = descriptor.value as Function

  // TODO: can add type verify here
  // type ArrType = Parameters<typeof func>
  // type SecondParam = ArrType[0]
  // let params: ArrType = []
  // type IdxParamType = ArrType[0]

  if (!Reflect.has(target, __MethodParamsMap)) return

  let methodParamMap = target[__MethodParamsMap].get(propertyKey) as Map<number, ParamInfo>

  descriptor.value = async function (this: any, ...args: any) {

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
        // console.error(`index: ${key}, name: ${info.name}, value: ${arg}`)
      })

      let result = await Reflect.apply(func, this, arr)
      resp.json(result)
      resp.end()
      return result
    } else {
      let result = await Reflect.apply(func, this, [req, resp])
      resp.json(result)
      resp.end()
      return result
    }
  }

  return descriptor
}

function _genParamMap(target: any, methodKey: string | symbol, parameterIndex: number, name: string, type: number) {
  let methodParamMap = Reflect.has(target, __MethodParamsMap) ? Reflect.get(target, __MethodParamsMap) : new Map()
  let methodInfo: Map<number, ParamInfo> = methodParamMap.has(methodKey) ? methodParamMap.get(methodKey) : new Map()
  methodInfo.set(parameterIndex, { name: name, type: type })
  methodParamMap.set(methodKey, methodInfo)
  Reflect.set(target, __MethodParamsMap, methodParamMap)
}

function QueryParam(name: string): ParameterDecorator {
  return (target: any, methodKey: string | symbol, parameterIndex: number) => {
    _genParamMap(target, methodKey, parameterIndex, name, 0)
  }
}

function BodyParam(name?: string): ParameterDecorator {
  return (target: any, methodKey: string | symbol, parameterIndex: number) => {
    _genParamMap(target, methodKey, parameterIndex, name, 1)
  }
}

function Get(url: string, desc?: string): MethodDecorator {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    _genMethodRouter(target, propertyKey, url)
    return _makeResponse(target, propertyKey, descriptor)
  }
}

function Post(url: string): MethodDecorator {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    _genMethodRouter(target, propertyKey, url)
    return _makeResponse(target, propertyKey, descriptor)
  }
}

function All(url: string): MethodDecorator {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    _genMethodRouter(target, propertyKey, url)
    return _makeResponse(target, propertyKey, descriptor)
  }
}


export { Router, Route, Component, Controller, Service, Get, Post, All, QueryParam, BodyParam }

