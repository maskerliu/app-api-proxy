

function Repository(path: string, dbName: string) {
  return <T extends { new(...args: any[]): {} }>(constructor: T) => {
    return class extends constructor {
      init() {

        return this;
      }
    }
  }
}


export { Repository }