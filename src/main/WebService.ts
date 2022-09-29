import { Request, Response } from "express"
import { BizCode, BizResponse, CMDType, PushMsg, PushMsgType } from "../common/models/DataModels"
import mockService from "./MockService"
import proxyService from "./ProxyService"
import pushService from "./PushService"

class WebService {

  filter(req: Request, resp: Response) {
    let path = parseUrl(req.url)
    try {
      if (Reflect.get(mockService, path) != null) {
        Reflect.apply(Reflect.get(mockService, path), mockService, [req, resp])
      } else if (Reflect.get(pushService, path) != null) {
        Reflect.apply(Reflect.get(pushService, path), pushService, [req, resp])
      } else if (Reflect.get(proxyService, path)) {
        Reflect.apply(Reflect.get(proxyService, path), proxyService, [req, resp])
      } else if (Reflect.get(this, path)) {
        Reflect.apply(Reflect.get(this, path), this, [req, resp])
      }
    } catch (err) {
      console.log("WebService", err)
      this.error(req, resp, err)
    }
  }

  public register(req: Request, resp: Response) {
    let uid = req.query["uid"] as string
    if (uid != null) {
      let bizResp: BizResponse<string> = {
        code: BizCode.SUCCESS,
        data: "注册成功"
      }
      resp.json(bizResp)
      resp.end()
      let data: PushMsg<any> = {
        type: PushMsgType.CMD,
        payload: {
          type: CMDType.REGISTER,
          content: uid
        }
      }
      pushService.sendMessage(uid, data)
    } else {
      resp.end("invalid uid")
    }
  }

  private error(req: Request, resp: Response, err: any) {
    // resp.writeHead(400, DEFAULT_HEADER)
    let bizResp: BizResponse<string> = {
      code: BizCode.ERROR,
      message: err.message
    }
    resp.json(bizResp)
    resp.end()
  }
}

export function parseUrl(url: string): string {
  let length = /^\/appmock\//.test(url) ? 9 : 0
  let path = url.substring(length).split("?")[0]
  return path
}

export default new WebService()
