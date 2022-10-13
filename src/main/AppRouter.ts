import express, { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

export const router = Router()


export class RouterConfig {
  filePath = `${path.resolve()}/src/controller`

  async registerRouters(app: any) {
    return new Promise((resolve, reject) => {
      fs.readdir(this.filePath, (err: any, files: any) => {
        if (err) reject('controller file path error')

        files.forEach((file: string) => {
          const nowClazz = require(this.filePath + "/" + file)
          if (typeof nowClazz === 'object') { new nowClazz['default']() }
        })

        const { routerArr } = require('../decorators/Controller')
        routerArr.forEach((router: string) => { app.use(router) })
        resolve(true)
      })
    })
  }
}