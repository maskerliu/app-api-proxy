import "@vant/touch-emulator"
import { createPinia } from 'pinia'
import vant from "vant"
import 'vant/lib/index.css'
import { createApp } from "vue"
import App from "./App.vue"
import router from "./router"


const __DEV__ = process.env.NODE_ENV !== 'production'

const pinia = createPinia()
const app = createApp(App)

app.use(router)
app.use(pinia)
app.use(vant)
app.mount("#app")
