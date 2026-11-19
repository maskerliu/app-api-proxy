import path from 'path'

/**
 * 保存框的选项组装。`saveFile`（渲染层给数据、主进程写盘）与 `selectSavePath`（只拿路径，
 * 由主进程自己边拼边写）共用一份，否则两条通道给出的过滤器与初始目录会走偏。
 */

export function buildSaveFilters(fileName: string) {
  const filters = [{ name: '全部文件', extensions: ['*'] }]
  const ext = path.extname(fileName ?? '')
  if (ext && ext !== '.') {
    const name = ext.slice(1, ext.length)
    // 空 name 在系统保存面板里是一行没有标签的过滤器，用户看不出它只匹配 .json/.har
    if (name) {
      filters.unshift({ name: `${name.toUpperCase()} (${ext})`, extensions: [name] })
    }
  }
  return filters
}

export function saveDialogOptions(title: string, baseDir: string, fileName: string) {
  return {
    title,
    filters: buildSaveFilters(fileName),
    defaultPath: path.join(baseDir, fileName)
  }
}
