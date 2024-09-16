import { createI18n, useI18n } from 'vue-i18n'

import zh_CN from './zh-CN'
import en from './en'

// 语言库
const messages = {
  'zh-CN': zh_CN,
  'en': en
}

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',		//默认显示的语言 
  messages
})

const { t, tm } = i18n.global

export const $t = t
export const $tm = tm
export default i18n // 将i18n暴露出去，在main.js中引入挂载