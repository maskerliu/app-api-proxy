import { createRouter, createWebHashHistory } from 'vue-router'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/proxy'
    },
    {
      path: '/onboarding',
      name: 'Onboarding',
      component: require('../pages/onboarding/Onboarding.vue').default
    },
    {
      path: '/diagnostic',
      name: 'Diagnostic',
      component: require('../pages/onboarding/Diagnostic.vue').default
    },
    {
      path: '/proxy',
      name: 'Proxy',
      component: require('../pages/proxy/Proxy.vue').default
    },
    {
      path: '/settings',
      name: 'Settings',
      component: require('../pages/settings/Settings.vue').default
    }
  ],
})
