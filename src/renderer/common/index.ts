export { PushClient } from './PushClient'

export function throttle(fn: Function, delay: number) {
  let timer = null;
  return (...args: any) => {
    if (!timer) {
      timer = setTimeout(() => {
        fn.apply(this, args);
        timer = null;
      }, delay);
    }
  };
}


export function random(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}