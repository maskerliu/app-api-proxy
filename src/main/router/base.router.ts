import express, { Request, Response, Router } from "express"
import formidable, { File, Fields, Files } from 'formidable'
import { rmSync } from 'fs'
import { BizCode, BizFail, BizResponse } from "@shared/base.models"
import { MOCK_PACK_MAX_FILE_BYTES } from "@shared/mock.pack"
import { BizNetwork, fetchFormFileText, parseContext, parseJsonBody, removeUploadedFiles } from "../misc/utils"


export enum ParamType {
  Header,
  Path,
  Query,
  FormBody,
  /** 上传文件的 utf-8 文本：格式由服务端按包内 format 字段分派，不按 mimetype 猜测 */
  FormFileText
}

// multipart 的硬上限只负责兜住磁盘：真正的「超过 50MB」判定在包级校验里产出 packTooLarge，
// 所以这里留 1MB 余量，让略微超限的文件仍能进到服务端拿到可解释的错误码；
// 再大的文件在传输层就被切断，渲染层必须在上传前按 file.size 自己拦一道。
const MULTIPART_MAX_FILE_BYTES = MOCK_PACK_MAX_FILE_BYTES + 1024 * 1024
const MULTIPART_MAX_FILES = 1
const MULTIPART_MAX_FIELDS = 20

export interface ParamInfo {
  key: string
  type: ParamType
}

export interface ApiInfo {
  method: string,
  path: string,
  params?: Array<ParamInfo>
  // 目标服务方法由子类用闭包给出：方法名写错编译期就报错，不再按字符串反射查找
  handler: (...args: Array<any>) => any
}

export abstract class BaseRouter {

  private _router: Router
  private _apiInfos: Array<ApiInfo> = []

  constructor() {
    this._router = express.Router()
    this.initApiInfos()

    for (const item of this._apiInfos) {
      this.router[item.method](item.path, (req: Request, resp: Response) => {
        this.route(req, resp, item.handler, item.params)
      })
    }
  }

  public get router() { return this._router }

  protected abstract initApiInfos(): void

  protected addApiInfo(apiInfo: ApiInfo): void {
    this._apiInfos.push(apiInfo)
  }

  protected async route(req: Request, resp: Response, handler: (...args: Array<any>) => any,
    paramInfos?: Array<ParamInfo>) {

    let bizResp: BizResponse<any>
    let uploaded: Array<File> = []
    try {
      let params: Array<any> = [], contentType: string = null, _: any, jsonBody: JSON
      if (paramInfos != null) {

        if (req.method.toLowerCase() == 'post') {
          // console.log('content-type', req.headers['content-type'])
          // let matchs = req.headers['content-type']?.match(/[\da-zA-Z\:\/\-\=]+/g)
          // console.log(matchs)
          // if (req.)
          [contentType, _] = req.headers['content-type']?.match(/[\da-zA-Z\:\/\-\=]+/g) ?? []
          if (contentType == BizNetwork.MIME_MULTIPART) {
            const parsed = await this.parseMultipart(req, uploaded)
            req['files'] = parsed.files
            req['fields'] = parsed.fields
          } else if (contentType == BizNetwork.MIME_JSON) {
            jsonBody = parseJsonBody(req)
          }
        }
        let filesBody = req['files'] as Files<string>
        let fieldsBody = req['fields'] as Fields<string>
        for (const item of paramInfos) {
          if (item.type == ParamType.FormBody) {
            if (contentType == BizNetwork.MIME_MULTIPART) {
              params.push(fieldsBody ?? {})
            } else if (contentType == BizNetwork.MIME_JSON) {
              params.push(jsonBody)
            } else if (contentType == BizNetwork.MIME_FORM) {
              params.push(req.body[item.key])
            } else {
              params.push(req.body)
            }
          } else if (item.type == ParamType.FormFileText) {
            // formidable 把「有 filename 但没有 Content-Type」的部分当字段处理（浏览器上传 .har 时正是这种），
            // 两边都取一次，调用方拿到的都是同一段 utf-8 文本
            params.push(fetchFormFileText(filesBody?.[item.key] ?? fieldsBody?.[item.key]))
          } else {
            let value = this.parseParam(req, item.key, item.type)
            params.push(value)
          }
        }
      }

      params.push(parseContext(req))
      let result = await handler(...params)
      if (result == null) {
        bizResp = { code: BizCode.FAIL, msg: 'biz inner error, no result found' }
      } else {
        bizResp = { code: BizCode.SUCCESS, data: result }
      }
    } catch (err) {
      console.error("error:", err)
      if (err instanceof BizFail) {
        bizResp = { code: err.code, msg: err.msg }
      } else {
        // Error.toString() 会带 "Error: " 前缀，直接展示给用户时去掉
        bizResp = { code: BizCode.ERROR, msg: err instanceof Error ? err.message : String(err) }
        // Mock 匹配引擎的结构化错误：错误码与冲突记录 ID 供 UI 定位，不改变原有 msg 行为
        const extra = err as any
        if (extra?.name === 'MockError') {
          bizResp.errorCode = extra.code
          if (extra.detail != null) bizResp.detail = extra.detail
          if (extra.existingRecordId != null) bizResp.existingRecordId = extra.existingRecordId
        }
        if (Array.isArray(extra?.issues)) bizResp.issues = extra.issues
      }
    } finally {
      resp.json(bizResp)
      resp.end()
      // 响应已经发出再清理：解析失败、校验拒绝、取消都走到这里，50MB 级上传不留临时文件
      removeUploadedFiles(uploaded)
    }
  }

  /** IncomingForm 一次只能解析一个请求，故每条 multipart 请求新建实例 */
  private async parseMultipart(req: Request, uploaded: Array<File>) {
    const form = formidable({
      maxFiles: MULTIPART_MAX_FILES,
      maxFields: MULTIPART_MAX_FIELDS,
      maxFileSize: MULTIPART_MAX_FILE_BYTES,
      maxTotalFileSize: MULTIPART_MAX_FILE_BYTES,
      // 没有 mimetype 的文件部分会走 fields 通道，受的是这个上限，与文件通道保持同一口径
      maxFieldsSize: MULTIPART_MAX_FILE_BYTES,
      // 空文件默认会被 formidable 以「File too small」拒绝，用户看到的是组件库的英文报错；
      // 放开后它变成一段空文本，由包校验给出 packEmpty 这种能看懂的原因。
      allowEmptyFiles: true,
      minFileSize: 0,
    })
    // 超限、客户端中断、multipart 截断时 parse() 直接 reject，返回值里没有任何文件，
    // 所以清单由调用方持有：解析前先把已打开的文件交出来，异常路径也能删干净。
    // 事件必须逐个登记而不是等解析结束读 form.openedFiles——那正是 parse reject 时拿不到的那份。
    // （formidable 出错时自己也会 destroy + unlink，但它不等我们发完响应，不能把清理寄托在它身上）
    form.on('fileBegin', (_name, file) => uploaded.push(file))
    const [fields, files] = await form.parse(req)
    return { fields, files }
  }

  protected parseParam(req: Request, paramName: string, type: ParamType) {
    let value: any
    switch (type) {
      case ParamType.Header:
        value = req.headers[paramName]
        break
      case ParamType.Path:
        value = req.params[paramName]
        break
      case ParamType.Query:
        value = req.query[paramName]
        break
    }
    return value
  }

}