### AppApiProxy

![数据预览](./icons/icon.png)

> 旨在推动前后端研发分离的效率小工具，方便前端（移动/PC/FE）同学在研发过程透过代理方便地查看请求数据/伪造数据/覆盖边界，结合接口设计可在前后端并行开发中通过数据Mock功能实现对API接口实现依赖的解耦，加速研发流程。
> 原工程[app-mock-desktop](https://github.com/maskerliu/app-mock-desktop) 现在废弃了。
> 欢迎大家试用


> 这是一个集成了vue3+vant+pinia+webpack5的electron项目，应用构建使用electron-builder。
> 使用了[electron-vue-boilerplates](https://github.com/maskerliu/electron-vue-boilerplates)，这是一个支持使用vue3来构建electron应用的脚手架，使用webpack5，参考了[electron-vue](https://github.com/SimulatedGREG/electron-vue)，升级了其老旧的脚本，并使用typescript来实现。

![代理注册](./images/FE5C9F9F-DB68-401e-89A2-F8B968A75677.png)

![请求代理](./images/EE317B56-1C72-4b5f-AF1D-9F38411C691B.png)

![数据预览](./images/AF5E3CD2-E9BB-40bd-A240-DD2A3FD91BA6.png)

![Mock规则管理](./images/95C0EED0-BBEC-4fbb-9ADA-A81A1CC06255.png)

![设置](./images/F0AB5D38-FFAA-4be5-8217-E7FE7091809D.png)

#### Build Setup

``` bash
# install dependencies
yarn 

# serve with hot reload at localhost:9080
yarn dev

# build electron application for production
yarn build

```

#### 接入指南
您的应用需对网络请求框架做一个简单改造，在所有需要接入ApiProxy的请求URL的Host的替换为ApiProxy提供的Host，同时在需代理请求的Header中添加

``` java
req.headers['mock-host'] = origin_host;
req.headers['mock-uid'] = mock_uid;
```
 即完成应用端改造，其中origin_host为原请求的host，mock-uid为AppMock代理请求client的id。