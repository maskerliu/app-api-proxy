### wasm build handbook


``` bash
# -O1 默认编译，无优化，-O2 开启编译优化，产物尺寸变大
emcc -O2 hello.c -s WASM=1 -o ../../build/hello.html
```