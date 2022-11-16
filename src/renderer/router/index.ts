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
      path: '/proxy',
      name: 'Proxy',
      component: require('../pages/proxy/Proxy.vue').default
    },
    {
      path: '/lab',
      name: 'Lab',
      redirect: '/lab/iot',
      children: [
        {
          path: 'iot',
          name: 'IOTDeviceMgr',
          component: require('../pages/lab/IOTMgr.vue').default
        }
      ]
    },
    {
      path: '/fun',
      name: 'Fun',
      redirect: '/fun/gameLobby',
      children: [
         {
          path: 'gameLobby',
          name: 'GameLobby',
          component: require('../pages/fun/GameLobby.vue').default,
        },
        {
          path: 'videoLab',
          name: 'VideoLab',
          component: require('../pages/fun/VideoLab.vue').default,
        }
      ]
    },
    {
      path: '/fun/video',
      name: 'VideoLab',
      component: require('../pages/fun/GameLobby.vue').default
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
