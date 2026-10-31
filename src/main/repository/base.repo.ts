
import { injectable } from 'inversify'
import PouchFind from 'pouchdb-find'
import PouchDB from 'pouchdb-node'

PouchDB.plugin(PouchFind)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

@injectable()
export default class BaseRepo<T extends PouchDB.Core.RemoveDocument> {

  protected pouchdb: PouchDB.Database

  public async search(field?: string, query?: string, returnFields?: Array<string>) {
    let request: PouchDB.Find.FindRequest<T> = {
      selector: {
        _id: { $ne: /_design\/idx/ },
      },
      limit: 15,
      fields: returnFields
    }

    if (query != null && field != null) {
      request.selector[field] = { $regex: new RegExp(escapeRegExp(String(query)), 'i') }
    }

    return this.find(request)
  }

  public async find(request: PouchDB.Find.FindRequest<T>): Promise<Array<T>> {
    try {
      let result = await this.pouchdb.find(request)
      return result.docs.map(it => it as T)
    } catch (err) {
      throw new Error(`查询失败: ${errorMessage(err)}`)
    }
  }

  public async get(field: string, query: string, returnFields?: Array<string>): Promise<T> {
    try {
      let request: PouchDB.Find.FindRequest<T> = {
        selector: {
          _id: { $ne: /_design\/idx/ },
        },
        limit: 15,
        fields: returnFields
      }

      request.selector[field] = { $eq: query }

      let result = await this.pouchdb.find(request)
      return result.docs[0] as unknown as T
    } catch (err) {
      throw new Error(`查询失败: ${errorMessage(err)}`)
    }
  }

  public async update(item: T): Promise<string> {
    try {
      let getResult = await this.get('_id', item._id, ['_rev'])
      let result: PouchDB.Core.Response
      if (getResult) {
        item._rev = getResult._rev
        result = await this.pouchdb.put(item)
      } else {
        result = await this.pouchdb.post(item)
      }
      return result.ok ? result.id : null
    } catch (err) {
      throw new Error(`更新失败: ${errorMessage(err)}`)
    }
  }

  public async delete(id: string): Promise<boolean> {
    try {
      let item = await this.get('_id', id, ['_id', '_rev'])
      if (item == null) return false
      let removeResult = await this.pouchdb.remove(item._id, item._rev)
      return removeResult.ok
    } catch (err) {
      throw new Error(`删除失败: ${errorMessage(err)}`)
    }
  }
}
