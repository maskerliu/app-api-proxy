<template>
  <div id="map_container" class="full-row"></div>
</template>

<script lang="ts" setup>
import { load } from '@amap/amap-jsapi-loader';
import { onMounted, shallowRef, watch } from 'vue';

let AMap: any = null
const map = shallowRef(null)
const props = defineProps({
  lat: Number,
  lng: Number,
  address: String,
})

const emits = defineEmits(['update:lat', 'update:lng', 'update:address'])

onMounted(() => {
  initMap()
})

watch(() => props.address, () => {
  let center = new AMap.LngLat(props.lng, props.lat)
  map.value.setCenter(center)
})

async function initMap() {
  AMap = await load({
    "key": "fa8ed986df0438acb931c57ed3180dcc",
    "version": "2.0",
    "plugins": ['AMap.Scale', 'AMap.Marker', 'AMap.Geocoder', 'AMap.ToolBar'],
    "AMapUI": {
      "version": '1.1',
      "plugins": ['misc/PositionPicker'],
    },
  })

  map.value = new AMap.Map("map_container", { viewMode: "2D", zoom: 18, })

  let center = new AMap.LngLat(props.lng, props.lat)
  map.value.setCenter(center)

  map.value.addControl(new AMap.ToolBar())

  AMapUI.loadUI(['misc/PositionPicker'], (PositionPicker: any) => {
    let positionPicker = new PositionPicker({ mode: 'dragMap', map: map.value })

    positionPicker.on('success', (location: any) => {
      emits('update:address', location.address)
      emits('update:lat', location.position.lat)
      emits('update:lng', location.position.lng)
    })
    positionPicker.on('fail', (positionResult) => {

    })
    positionPicker.start(center)
  })
}
</script>

<style>

</style>