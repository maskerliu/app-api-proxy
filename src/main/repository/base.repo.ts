
import { injectable } from 'inversify'
import 'pouchdb-node'

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

    if (query != null) {
      request.selector[field] = { $regex: new RegExp(`${query}`) }
    }

    return this.find(request)
  }

  public async find(request: PouchDB.Find.FindRequest<T>) {
    let data: Array<T> = new Array()
    try {
      let result = await this.pouchdb.find(request)
      if (result.docs) {
        result.docs.forEach(it => {
          data.push(it as T)
        })
      }
    } catch (err) {
      throw '查询失败' + err
    } finally {
      return data
    }
  }

  public async get(field: string, query: string, returnFields?: Array<string>) {
    let data: T
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
      if (result.docs) {
        data = result.docs[0] as unknown as T
      }
    } catch (err) {
      throw '查询失败' + err
    } finally {
      return data
    }
  }

  public async update(item: T) {
    let resultId: string = null
    try {
      let getResult = await this.get('_id', item._id, ['_rev'])
      let result = null
      if (getResult) {
        item._rev = getResult._rev
        result = await this.pouchdb.put(item)
      } else {
        result = await this.pouchdb.post(item)
      }
      if (result.ok) resultId = result.id
    } catch (err) {
      throw '更新失败' + err
    } finally {
      return resultId
    }
  }

  public async delete(id: string) {
    let result = false
    try {
      let item = await this.get('_id', id, ['_id', '_rev'])
      let removeResult = await this.pouchdb.remove(item._id, item._rev)
      result = removeResult.ok
    } catch (err) {
      throw '删除失败' + err
    } finally {
      return result
    }
  }
}