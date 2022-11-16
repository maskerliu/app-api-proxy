import { app } from 'electron'
import { Repository } from 'lynx-express-mvc'
import { Fun } from '../../common/fun.models'
import BaseRepo from './base.repo'

@Repository(app.getPath('userData') + '/biz_storage', 'GameDB', ['name'])
export default class GameRepo extends BaseRepo<Fun.GameItem> {

  public async search(field?: string, query?: string, returnFields?: Array<string>) {
    let request: PouchDB.Find.FindRequest<Fun.GameItem> = {
      selector: {
        _id: { $ne: /_design\/idx/ },
      },
      limit: 5,
      fields: returnFields
    }

    if (query != null) {
      request.selector[field] = { $eq: query }
    }

    return this.find(request)
  }


}