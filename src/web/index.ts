import '@vant/touch-emulator'
import { createPinia } from 'pinia'
import vant from 'vant'
import 'vant/lib/index.css'
import { createApp } from 'vue'
import i18n from '../lang'
import router from '../renderer/router'
import App from './App.vue'
// import 'default-passive-events'


const pinia = createPinia()
const app = createApp(App)

app.use(i18n)
app.use(router)
app.use(pinia)
app.use(vant)
app.mount('#app')
