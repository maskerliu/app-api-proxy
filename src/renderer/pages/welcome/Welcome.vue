<template>


  <div align="center">
    <svg t="1667469091993" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
      p-id="11506" width="512" height="512">
      <path class="icon-path-mountain" stroke-width="5" stroke="#3C403B"
        d="M789.271 408.458c-34.693-72.439-83.605-112.333-137.727-112.333-35.399 0-69.332 17.457-98.129 50.482-7.962 9.132-15.541 19.496-22.665 30.934-6.814-26.026-14.364-50.818-22.626-74.161-21.743-61.432-47.467-110.148-76.459-144.795-33.839-40.439-71.28-60.944-111.283-60.944s-77.444 20.504-111.282 60.944c-28.992 34.646-54.716 83.363-76.458 144.794-43.272 122.263-67.104 284.17-67.104 455.895 0 17.673 14.327 32 32 32s32-14.327 32-32c0-164.637 22.529-318.96 63.436-434.541 36.144-102.123 83.773-163.092 127.408-163.092 43.635 0 91.265 60.969 127.409 163.092 40.907 115.581 63.436 269.904 63.436 434.541 0 17.673 14.327 32 32 32s32-14.327 32-32c0-96.982-7.603-190.831-22.014-276.178 0.131-0.366 0.263-0.73 0.381-1.104 23.48-74.032 61.928-121.869 97.949-121.869 27.72 0 56.88 27.693 80.005 75.977 27.054 56.49 41.953 132.309 41.953 213.489 0 17.673 14.327 32 32 32s32-14.327 32-32c0.001-90.551-17.128-176.187-48.23-241.131z"
        fill="#3C403B" p-id="11507"></path>
      <path class="icon-path-road" stroke-width="5" stroke="#62BC3E"
        d="M298.409 958.84c-15.992 0-30.755-0.325-44.049-0.989-17.651-0.881-31.246-15.905-30.364-33.556 0.881-17.652 15.897-31.266 33.556-30.364 114.254 5.701 374.673-16.092 560.597-64.135-15.111-4.154-31.944-8.379-49.473-12.778-42.649-10.704-86.75-21.772-117.663-34.789-11.843-4.987-20.789-10.334-27.35-16.348-15.659-14.352-15.854-30.138-14.576-38.271 2.198-13.988 11.183-25.579 26.704-34.451 8.245-4.712 18.804-8.996 32.279-13.097 19.913-6.06 46.798-11.839 79.908-17.177 55.095-8.882 108.573-13.587 110.822-13.782 17.616-1.553 33.123 11.496 34.656 29.103 1.534 17.606-11.496 33.122-29.103 34.655-0.566 0.05-44.602 3.93-92.206 11.04-26.698 3.987-46.847 7.843-61.989 11.3 22.419 6.771 48.535 13.326 74.096 19.741 31.273 7.85 60.813 15.263 83.767 23.066 13.991 4.757 24.229 9.196 32.216 13.969 20.751 12.399 25.318 27.705 25.497 38.362 0.148 8.919-2.818 25.797-24.366 38.621-8.797 5.235-20.36 9.815-36.391 14.413-85.45 24.507-200.868 45.756-324.994 59.834-89.156 10.113-175.713 15.633-241.574 15.633z"
        fill="#62BC3E" p-id="11508"></path>
    </svg>
  </div>


</template>

<script lang="ts" >
import { defineComponent } from 'vue'

const Welcome = defineComponent({
  name: "Welcome",
  mounted() { },
  methods: {},
})

export default Welcome
</script>
<style scoped>
.icon-path-mountain {
  animation: icon-path-animation0 2s ease-in;
}

.icon-path-road {
  animation: icon-path-animation1 4s ease-in;
}

@keyframes icon-path-animation0 {
  0% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 4917;
  }

  40% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 0;
    fill: #3C403B55;
  }

  60% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 0;
    fill: #3C403BAA;
  }

  100% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 0;
    fill: #3C403BFF;
  }
}


@keyframes icon-path-animation1 {
  0% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 4917;
  }

  40% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 0;
    fill: #62BC3E55;
  }

  60% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 0;
    fill: #62BC3EAA;
  }

  100% {
    stroke-dasharray: 4917;
    stroke-dashoffset: 0;
    fill: #62BC3EFF;
  }
}
</style>