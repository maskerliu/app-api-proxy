import '@vant/touch-emulator'
import { ClickScrollPlugin, OverlayScrollbars } from 'overlayscrollbars'
import 'overlayscrollbars/overlayscrollbars.css'
import { createPinia } from 'pinia'
import vant from 'vant'
import 'vant/lib/index.css'
import { createApp } from 'vue'
import i18n from '../lang'
import App from './App.vue'
import router from './router'

OverlayScrollbars.plugin(ClickScrollPlugin)

const pinia = createPinia()
const app = createApp(App)
app.use(i18n)
app.use(router)
app.use(pinia)
app.use(vant)
app.mount('#app')

