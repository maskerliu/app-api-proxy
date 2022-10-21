

const IOCContainer: Map<string | symbol, any> = new Map()



function Autowired(name?: string): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {

    if (IOCContainer.has(propertyKey)) {
      Reflect.set(target, propertyKey, IOCContainer.get(propertyKey))
      return
    }

    if (IOCContainer.has(name)) {
      Reflect.set(target, propertyKey, IOCContainer.get(name))
      return
    }
  }
}