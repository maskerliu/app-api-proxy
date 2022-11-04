<template>
  <div id="map_container" style="width: 100%; height: 100%;"></div>
</template>

<script lang="ts">
import AMapLoader from '@amap/amap-jsapi-loader';
import { defineComponent, shallowRef } from 'vue';

let AMap: any = null

const AmapViewer = defineComponent({
  props: {
    lat: Number,
    lng: Number,
    address: String,
  },
  emits: ['update:lat', 'update:lng', 'update:address'],
  setup() {
    const map = shallowRef(null);
    return {
      map,
    }
  },
  async mounted() {
    this.initMap()
  },
  methods: {
    async initMap() {
      AMap = await AMapLoader.load({
        "key": "fa8ed986df0438acb931c57ed3180dcc",
        "version": "2.0",
        "plugins": ['AMap.Scale', 'AMap.Marker', 'AMap.Geocoder', 'AMap.ToolBar'],
        "AMapUI": {
          "version": '1.1',
          "plugins": ['misc/PositionPicker'],
        },
      })

      this.map = new AMap.Map("map_container", { viewMode: "2D", zoom: 18, })

      let center = new AMap.LngLat(this.lng, this.lat)
      this.map.setCenter(center)

      this.map.addControl(new AMap.ToolBar());

      AMapUI.loadUI(['misc/PositionPicker'], (PositionPicker: any) => {
        let positionPicker = new PositionPicker({ mode: 'dragMap', map: this.map })

        positionPicker.on('success', (location: any) => {
          this.$emit('update:address', location.address)
          this.$emit('update:lat', location.position.lat)
          this.$emit('update:lng', location.position.lng)
        })
        positionPicker.on('fail', (positionResult) => {

        })
        positionPicker.start(center)
      })
    },
  },
  watch: {
    address() {
      let center = new AMap.LngLat(this.lng, this.lat)
      this.map.setCenter(center)
    },
  }
})

export default AmapViewer
</script>

<style>

</style>