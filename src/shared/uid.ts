/**
 * 纯函数模块：主进程与渲染进程共用，禁止引入 electron / axios / vant 等环境依赖。
 */
export function generateUid(): string {
  const len = 8
  const res: string[] = []
  for (let i = 0; i !== len; ++i) {
    res.push(
      String.fromCharCode(
        Math.floor(Math.random() * 26) + (Math.random() > 0.5 ? 65 : 97)
      )
    )
  }
  res.push(new Date().getTime() + 'o')
  return res.join('')
}
