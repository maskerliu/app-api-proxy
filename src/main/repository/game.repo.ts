import { Repository } from 'lynx-express-mvc'
import { Fun } from '../../common/fun.models'
import { USER_DATA_DIR } from '../common/Const'
import BaseRepo from './base.repo'

@Repository(USER_DATA_DIR + '/biz_storage', 'GameDB', ['name'])
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