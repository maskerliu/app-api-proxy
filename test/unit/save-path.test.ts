import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { buildSaveFilters, saveDialogOptions } from '@main/misc/save-path'

// 两条落盘通道（saveFile 带数据 / selectSavePath 只拿路径）共用这份选项，
// 一旦分叉，用户在同一个导出动作里会看到两套过滤器与两个初始目录
describe('R4C-08 保存框选项', () => {
  it('带后缀时把后缀过滤器排在最前，全部文件保底', () => {
    assert.deepEqual(buildSaveFilters('appapi-mock-all.json'), [
      { name: 'JSON (.json)', extensions: ['json'] },
      { name: '全部文件', extensions: ['*'] },
    ])
  })

  it('HAR 同样按后缀命名，不写成 JSON', () => {
    assert.equal(buildSaveFilters('site.har')[0].name, 'HAR (.har)')
  })

  it('无后缀与只有点时只留全部文件：空 name 的过滤器在系统面板里没有标签', () => {
    assert.deepEqual(buildSaveFilters('backup'), [{ name: '全部文件', extensions: ['*'] }])
    assert.deepEqual(buildSaveFilters('.'), [{ name: '全部文件', extensions: ['*'] }])
    assert.deepEqual(buildSaveFilters(''), [{ name: '全部文件', extensions: ['*'] }])
    assert.deepEqual(buildSaveFilters(null), [{ name: '全部文件', extensions: ['*'] }])
  })

  it('隐藏文件（.json）不算后缀', () => {
    assert.equal(buildSaveFilters('.json').length, 1)
  })

  it('初始目录 = baseDir + 文件名，标题原样透传', () => {
    const options = saveDialogOptions('选择导出位置', 'D:/data', 'pack.json')
    assert.equal(options.title, '选择导出位置')
    assert.equal(options.defaultPath, path.join('D:/data', 'pack.json'))
    assert.equal(options.filters[0].extensions[0], 'json')
  })
})
