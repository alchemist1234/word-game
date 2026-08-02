import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// uni-app Vue3 要求导出 createApp 工厂函数（支持多端 SSR 模式）
export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  return { app }
}
