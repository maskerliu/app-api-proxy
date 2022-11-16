import { UploadedFile } from 'express-fileupload'
import { Autowired, Service } from 'lynx-express-mvc'
import path from 'path'
import fs from 'fs'
import { Fun } from '../../common/fun.models'
import GameRepo from '../repository/game.repo'
import { app } from 'electron'


@Service()
export default class FunService {

  baseDir = app.getPath('userData') + '/static/games'

  @Autowired()
  gameRepo: GameRepo


  async getGames(keyword: string) {
    let games: Array<Fun.GameItem> = new Array()


    games.push({
      _id: '1', version: '1.0.10', author: 'lynxchina', name: '小人国', desc: '奇妙宇宙，与小伙伴们一起畅游',
      snaps: ['http://localhost:8884/_res/game_snap_fish.png',
        'http://localhost:8884/_res/game_snap_fish.png',
        'http://localhost:8884/_res/game_snap_fish.png'
      ],
      icon: 'http://localhost:8884/_res/liliput.png',
      url: 'https://www.baidu.com',
      _rev: null
    })
    games.push({
      _id: '2', version: '0.51.1', author: 'chris', name: '五子棋', desc: '奇妙宇宙，与小伙伴们一起畅游',
      snaps: ['http://localhost:8884/_res/game_snap_tictactoe.png'],
      icon: 'http://localhost:8884/_res/game_snap_fish.png',
      url: 'http://localhost:8884/_res/liliput/index.html',
      _rev: null
    })
    games.push({
      _id: '3', version: '2.5.1', author: 'dahaha', name: '打飞机', desc: '奇妙宇宙，与小伙伴们一起畅游',
      snaps: ['http://localhost:8884/_res/game_snap_cmdwar.png'],
      icon: 'http://localhost:8884/_res/game_snap_fish.png',
      url: 'http://localhost:8884/_res/liliput/index.html',
      _rev: null
    })

    games.push({
      _id: '4', version: '2.5.1', author: 'dahaha', name: '推箱子', desc: '推呀推',
      snaps: ['http://localhost:8884/_res/game_snap_sokoban.png'],
      icon: 'http://localhost:8884/_res/game_snap_fish.png',
      url: 'http://localhost:8884/_res/liliput/index.html',
      _rev: null
    })

    games.push({
      _id: '5', version: '1.5.1', author: 'dahaha', name: '坦克大战', desc: '经典坦克大战，快来守护你的家园',
      snaps: ['http://localhost:8884/_res/game_snap_tank.png'],
      icon: 'http://localhost:8884/_res/game_snap_fish.png',
      url: 'http://localhost:8884/_res/liliput/index.html',
      _rev: null
    })

    games.push({
      _id: '6', version: '4.5.1', author: 'dahaha', name: '大海盗', desc: '热血大航海，寻找你的one piece',
      snaps: ['http://localhost:8884/_res/game_snap_ship_war.png'],
      icon: 'http://localhost:8884/_res/game_snap_fish.png',
      url: 'http://localhost:8884/_res/liliput/index.html',
      _rev: null
    })

    games = await this.gameRepo.search()

    return games
  }

  async saveGame(game: Fun.GameItem, icon: UploadedFile, snaps: Array<UploadedFile>, bundle?: UploadedFile) {
    let gameId = await this.gameRepo.update(game)
    let item = await this.gameRepo.get('_id', gameId)

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir)
    }

    if (!fs.existsSync(path.join(this.baseDir, gameId))) {
      fs.mkdirSync(path.join(this.baseDir, gameId))
    }

    let ext: string

    if (icon != null) {
      ext = icon.name.split('.').pop()
      icon.mv(path.join(this.baseDir, gameId, icon.md5 + '.' + ext))
      item.icon = `http://localhost:8884/_res/games/${gameId}/${icon.md5}.${ext}`
    }

    if (game.snaps == null) {
      item.snaps = []
    } else {
      item.snaps = game.snaps
    }
    
    snaps.forEach(snap => {
      if (snap == null) { return }
      ext = snap.name.split('.').pop()
      snap.mv(path.join(this.baseDir, gameId, snap.md5 + '.' + ext))
      item.snaps.push(`http://localhost:8884/_res/games/${gameId}/${snap.md5}.${ext}`)
    })
    if (item.snaps.length > 3) item.snaps.splice(0, item.snaps.length - 3)

    if (bundle != null) {
      ext = bundle?.name.split('.').pop()
      bundle?.mv(path.join(this.baseDir, gameId, bundle.md5 + '.' + ext))
      item.url = `http://localhost:8884/_res/games/${gameId}/${bundle?.md5}.${ext}`
    }

    return await this.gameRepo.update(item)
  }
}