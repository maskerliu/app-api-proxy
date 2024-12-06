import { injectable } from "inversify"


export interface IVirtualService {

  responseAll(): any
}

@injectable()
export class VirtualService implements IVirtualService {



  responseAll() {
    throw new Error("Method not implemented.")
  }



}