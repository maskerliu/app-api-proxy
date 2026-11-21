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

// 默认名只决定面板开在哪，落盘路径来自对话框返回值；但 `defaultPath` 本身是 `path.join` 出来的，
// 名字里带分隔符就会把面板开到用户数据目录之外（用户按回车就等于选了那个目录）。
// 渲染层导出弹窗已经净化过一次，这里是主进程侧的同一道口子——不能只靠调用方自觉。
describe('保存框默认名的边界（R4C-29）', () => {
  const base = path.resolve('save-path-probe-base')

  /** 净化后的默认名必须还落在 base 里面：目录先 resolve，且要求分隔符边界（`save-path-probe-base-evil` 那种同前缀目录骗不过去） */
  function assertStaysInside(fileName: string) {
    const { defaultPath } = saveDialogOptions('选择导出位置', base, fileName)
    const inside = defaultPath === base || defaultPath.startsWith(base + path.sep)
    assert.equal(inside, true, `${JSON.stringify(fileName)} 把面板带到了 ${defaultPath}`)
  }

  it('相对越界、绝对路径与 UNC 都只留最后一段', () => {
    for (const fileName of ['../../evil.json', '..\\..\\evil.json', '/etc/passwd.json',
      'D:/Windows/evil.json', '\\\\server\\share\\evil.json', 'a/b/c/d.json', 'x/../y.json']) {
      assertStaysInside(fileName)
    }
    assert.equal(saveDialogOptions('t', base, '../../evil.json').defaultPath, path.join(base, 'evil.json'))
  })

  it('只剩分隔符或以 .. 收尾时只给目录，不给一个悬着分隔符的路径', () => {
    for (const fileName of ['', null, undefined, '/', '\\', '..', '../..', path.sep]) {
      assert.equal(saveDialogOptions('选择导出位置', base, fileName as any).defaultPath, base)
    }
  })

  it('过滤器按净化后的名字生成：带路径的名字不许产出一行没有标签的过滤器', () => {
    assert.deepEqual(buildSaveFilters('../../evil.json'), buildSaveFilters('evil.json'))
    assert.deepEqual(buildSaveFilters('a/b.json/..'), [{ name: '全部文件', extensions: ['*'] }])
  })
})
