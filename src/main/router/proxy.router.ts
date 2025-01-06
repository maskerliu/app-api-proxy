import express, { Router } from "express"
import proxy from 'express-http-proxy'

export class ProxyRouter {
  private _router: Router

  constructor() {
    this._router = express.Router()


    this.router.all('/_proxy', proxy('', {
      userResDecorator: function (proxyRes, proxyResData, userReq, userRes) {
        let data = JSON.parse(proxyResData.toString('utf8'))
        data.newProperty = 'exciting data'
        return JSON.stringify(data)
      }
    }))
  }

  public get router() { return this._router }
}