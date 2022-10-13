const routerArr = []

function Controller(target: any) {
  let obj = new target()
  for (let router in obj) {
    routerArr.push(obj[router])
  }
}

export { Controller, routerArr }