##### 生成根 CA 的私钥
``` bash
openssl genrsa -out rootCA.key 2048
```
##### 使用私钥生成根 CA 的证书
``` bash
openssl req -x509 -new -nodes -key rootCA.key -sha256 -days 1024 -out rootCA.crt
```
##### 生成IP的私钥
``` bash
openssl genrsa -out ip.key 2048
```
##### 使用私钥生成证书请求文件
``` bash
openssl req -new -key ip.key -out ip.csr
```
##### 创建证书扩展文件
> 为了确保为 10.12.0.2 签名的证书能够用作服务器身份验证，需要为它创建一个扩展文件。创建一个名为 v3.ext 的文件，并添加以下内容：
``` bash
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
# 这里 IP 替换成 DNS 就可以签名域名了
IP.1 = 10.12.0.2
```

##### 使用根 CA 的证书为 10.12.0.2 签名证书
``` bash
openssl x509 -req -in ip.csr -CA rootCA.crt -CAkey rootCA.key -CAcreateserial -out ip.crt -days 500 -sha256 -extfile v3.ext
```