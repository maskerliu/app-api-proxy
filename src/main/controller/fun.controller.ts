import type { UploadedFile } from 'express-fileupload'
import { Autowired, BodyParam, Controller, FileParam, Get, Post, QueryParam } from 'lynx-express-mvc'
import type { Fun } from '../../common/fun.models'
import FunService from '../service/fun.service'


@Controller('/fun/game')
export default class FunController {


  @Autowired()
  funService: FunService


  @Get('/search')
  async searchGames(@QueryParam('keyword') keyword: string) {
    return await this.funService.getGames(keyword)
  }

  @Post('/upload')
  async uploadResource(@QueryParam('uid') uid: string,
    @BodyParam('game') game: Fun.GameItem,
    @FileParam('icon') icon: UploadedFile,
    @FileParam('snap1') snap1: UploadedFile,
    @FileParam('snap2') snap2: UploadedFile,
    @FileParam('snap3') snap3: UploadedFile,
    @FileParam('bundle') bundle: UploadedFile) {
    return await this.funService.saveGame(game, icon, [snap1, snap2, snap3], bundle)
  }
}