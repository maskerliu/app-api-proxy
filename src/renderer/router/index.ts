import { createRouter, createWebHashHistory } from 'vue-router'


export default createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/info',
      name: 'Info',
      component: require('@/pages/info/EnvInfo').default,
    },
    {
      path: '/welcome',
      name: 'Welcome',
      component: require('@/pages/welcome/Welcome').default,
    },
    {
      path: '/proxy',
      name: 'Proxy',
      component: require('@/pages/proxy/Proxy').default,
    },
    {
      path: '/mockRuleMgr',
      name: 'MockRuleMgr',
      component: require('@/pages/mock/MockRuleMgr').default,
    },
    {
      path: '/lab',
      name: 'Lab',
      component: require('@/pages/lab/Lab').default,
    },
    {
      path: '/message',
      name: 'Message',
      component: require('@/pages/message/Message').default,
    },
    {
      path: '/settings',
      name: 'Settings',
      component: require('@/pages/settings/Settings').default,
    }
  ],
})
