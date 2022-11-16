<template>
  <div>
    <van-cell-group inset :title="$t('settings.games.title')">
      <van-field :label="$t('settings.games.upload')" label-width="10rem" v-model="searcKey" clearable>
        <template #right-icon>
          <van-button plain type="primary" size="mini" @click="onGameSelected(null)" icon="plus" />
        </template>
      </van-field>
      <van-list label-width="10rem" style="max-height: 130px; overflow-y: auto;" v-if="games != null">
        <van-cell v-for="item in games" :title-style="{ 'max-width': '200px' }" value-class="cell-value" clickable
          @click="onGameSelected(item)">
          <template #icon>
            <van-image width="50" height="50" radius="8" style="margin-right: 15px;" :src="item.icon" />
          </template>
          <template #title>
            <span>{{ item.name }}</span>
            <van-tag plain type="success" style="margin-left: 10px;">{{ item.author }}</van-tag>
            <van-tag type="success" style="margin-left: 10px;">@{{ item.version }}</van-tag>
          </template>
          <template #label>
            <p>{{ item.desc }}</p>
          </template>
          <template #value v-if="item.snaps != null">
            <van-image v-for="snap in item.snaps" width="140" height="100" radius="5" style="margin: 0 5px;"
              :src="snap" />
          </template>
        </van-cell>
      </van-list>
    </van-cell-group>

    <van-dialog :show="showGameUploader" style="min-width: 375px; width: 50%; max-width: 500px;"
      :confirm-button-text="$t('common.upload')" show-cancel-button :cancel-button-text="$t('common.cancel')"
      @cancel="showGameUploader = false" :beforeClose="beforeClose">
      <van-form ref="gameInfoForm" style="width: 100%" label-align="right" colon @submit="onSubmit">
        <van-field :label="$t('settings.games.name')" name="name" label-width="6rem" v-model="selectedGame.name" />
        <van-field :label="$t('settings.games.author')" name="author" label-width="6rem"
          v-model="selectedGame.author" />
        <van-field :label="$t('settings.games.version')" name="version" label-width="6rem"
          v-model="selectedGame.version" />
        <van-field :label="$t('settings.games.desc')" name="desc" label-width="6rem" v-model="selectedGame.desc"
          type="textarea" maxlength="50" show-word-limit />
        <van-field name="icon" :label="$t('settings.games.icon')" label-width="6rem">
          <template #input>
            <van-uploader v-model="gameIcon" :max-count="1" />
          </template>
        </van-field>
        <van-field name="snaps" :label="$t('settings.games.snap')" label-width="6rem">
          <template #input>
            <van-uploader v-model="gameSnaps" :max-count="3" />
          </template>
        </van-field>
        <van-field name="bundle" :label="$t('settings.games.res')" label-width="6rem">
          <template #input>
            <van-uploader v-model="gameBundle" accept="*" :max-count="1" upload-icon="sign" />
          </template>
        </van-field>
      </van-form>
    </van-dialog>
  </div>

</template>
<script lang="ts" setup>

import { UploaderFileListItem } from 'vant';
import { onMounted, ref, watch } from 'vue';
import { searchGames, uploadGameResource } from '../../../common/fun.api';
import { Fun } from '../../../common/fun.models';

const searcKey = ref<string>('')
const showGameUploader = ref(false)

const gameIcon = ref<Array<UploaderFileListItem>>([])
const gameSnaps = ref<Array<UploaderFileListItem>>([])
const gameBundle = ref<Array<UploaderFileListItem>>([])

const games = ref<Array<Fun.GameItem>>(null)
const selectedGame = ref<Fun.GameItem>(null)

const gameInfoForm = ref()

const beforeClose = (action: string) =>
  new Promise<boolean>((resolve) => {
    setTimeout(() => {
      if (action === 'confirm') {
        // console.log(gameInfoForm.value.getValues())
        gameInfoForm.value.submit()
        showGameUploader.value = false
        resolve(true)
      } else {
        // 拦截取消操作
        resolve(false)
      }
    }, 1000)
  })



onMounted(() => {

})

watch(searcKey, async () => {
  games.value = await searchGames(searcKey.value)
})


function onSubmit() {
  try {
    let formData = new FormData()
    formData.append('game', JSON.stringify(selectedGame.value))

    if (gameIcon.value[0] != null && gameIcon.value[0].file != null) {
      formData.append('icon', gameIcon.value[0].file)
    }
    selectedGame.value.snaps = []
    for (let i = 1; i <= gameSnaps.value.length; ++i) {
      let snap = gameSnaps.value[i - 1]
      if (snap != null && snap.file != null) {
        formData.append(`snap${i}`, snap.file)
      } else {
        selectedGame.value.snaps[i - 1] = snap.url
      }
    }
    if (gameBundle.value[0] != null && gameBundle.value[0].file != null) {
      formData.append('bundle', gameBundle.value[0].file)
    }
    uploadGameResource(formData)
  } catch (err) { console.log(err) }
}

function onGameSelected(game: Fun.GameItem) {

  if (game == null) {
    game = {
      _id: null,
      _rev: null,
      version: null,
      name: null,
      desc: null,
      icon: null,
      snaps: [],
      url: null
    }
  }
  selectedGame.value = game

  gameIcon.value = [{ url: game.icon }]

  gameSnaps.value = game.snaps.map(item => {
    return { url: item }
  })
  showGameUploader.value = true
}
</script>

<style>
.cell-value {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  height: 107px;
}
</style>