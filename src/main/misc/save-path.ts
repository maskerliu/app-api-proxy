import path from 'path'

/**
 * 保存框的选项组装。`saveFile`（渲染层给数据、主进程写盘）与 `selectSavePath`（只拿路径，
 * 由主进程自己边拼边写）共用一份，否则两条通道给出的过滤器与初始目录会走偏。
 */

/**
 * 渲染层给的名字只配决定「面板开在哪、框里写什么」，不配决定落盘位置：`path.join(baseDir, fileName)`
 * 遇到 `../../x`、`C:\Windows\x` 这类名字会把面板（`saveFile` 的静默档甚至直接就是写盘目标）
 * 带到用户数据目录之外。R4C-29 那条「文件名不参与路径拼接」在主进程侧的落点就是这里，
 * 上头的净化只发生在调用方一次，堵不住别的调用方。
 * 返回空串表示这个名字剥到最后什么都不剩，调用方必须自己决定回落，不许拼出一个悬着分隔符的路径。
 */
export function toSaveFileName(fileName: string): string {
  const text = String(fileName ?? '')
  // 不用 path.basename：主进程不保证跑在哪种平台上，而名字可能是 Windows 风格的（反斜杠在 POSIX 不是分隔符）
  const name = text.slice(Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) + 1)
  return name === '.' || name === '..' ? '' : name
}

export function buildSaveFilters(fileName: string) {
  const filters = [{ name: '全部文件', extensions: ['*'] }]
  const ext = path.extname(toSaveFileName(fileName))
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
  const name = toSaveFileName(fileName)
  return {
    title,
    filters: buildSaveFilters(name),
    defaultPath: name === '' ? baseDir : path.join(baseDir, name)
  }
}
