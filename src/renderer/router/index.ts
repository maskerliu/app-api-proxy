import { createRouter, createWebHashHistory } from 'vue-router'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/proxy'
    },
    {
      path: '/welcome',
      name: 'Welcome',
      component: require('../pages/welcome/Welcome.vue').default
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
      path: '/lab',
      name: 'Lab',
      component: require('../pages/lab/Lab.vue').default
    },
    {
      path: '/message',
      name: 'Message',
      component: require('../pages/message/Message.vue').default
    },
    {
      path: '/settings',
      name: 'Settings',
      component: require('../pages/settings/Settings.vue').default
    }
  ],
})
