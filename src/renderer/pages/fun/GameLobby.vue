<template>
  <van-row class="full-row">

    <van-row class="full-row" style="height: 225px; background-color: aliceblue;">
      <van-col span="7"></van-col>
      <van-col span="10">
        <van-swipe class="my-swipe" :autoplay="3000" indicator-color="white">
          <van-swipe-item v-for="item in games">
            <van-image :src="item.snaps[0]" width="100%" height="100%" fit="contain" position="bottom" />
            <div style="position: absolute; top: 40; left: 0; background-color: #0006;">
              <div class="single-line">{{ item.name }}</div>
              <div class="single-line">{{ item.desc }}</div>
            </div>
          </van-swipe-item>
        </van-swipe>
      </van-col>
      <van-col span="7"></van-col>
    </van-row>

    <van-row class="full-row" style="height: calc(100% - 225px);">
      <van-grid clickable>
        <van-grid-item icon="photo-o" text="文字" v-for="item in games" @click="openGame(item)">
          <template #icon>
            <van-image width="100" height="100" :src="item.icon" />
          </template>
          <template #text style="position: absolute;">
            <div style="position: absolute; top: 100; background-color: #0006;">
              <div class="single-line">{{ item.name }}</div>
              <div class="single-line">{{ item.desc }}</div>
            </div>

          </template>
        </van-grid-item>
      </van-grid>
    </van-row>
  </van-row>
</template>
<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { searchGames } from '../../../common/fun.api'
import { Fun } from '../../../common/fun.models'

const games = ref<Array<Fun.GameItem>>(null)
onMounted(async () => {
  games.value = await searchGames('')
})


function openGame(game: Fun.GameItem) {
  let args = JSON.parse(JSON.stringify(game))
  window.electronAPI.openGame(args)
}

</script>
<style scoped>
.my-swipe .van-swipe-item {
  width: 100%;
  height: 100%;
  color: #fff;
  font-size: 1rem;
  line-height: 1rem;
  text-align: center;
  background-color: #39a9ed;
}
</style>