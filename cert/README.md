##### 当前证书说明（server.crt / server.key）

`server.crt` 是自签名证书，SAN 覆盖 `localhost`、`127.0.0.1`、`::1`，有效期 825 天。
AppApiProxy 切到 https 后，浏览器和客户端需要把它加入受信任根证书，否则握手仍会被拒绝。

Windows 当前用户安装（无需管理员）：

```bash
certutil -user -addstore Root server.crt
```

重新生成（OpenSSL 3.x；Git Bash 下必须加 `MSYS_NO_PATHCONV=1`，否则 `/C=CN` 会被当成路径）：

```bash
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout server.key -out server.crt -days 825 -sha256 \
  -subj "/C=CN/ST=Shanghai/L=Shanghai/O=LynxChina/OU=lynxchina/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign" \
  -addext "extendedKeyUsage=serverAuth"

MSYS_NO_PATHCONV=1 openssl req -new -key server.key -out server.csr \
  -subj "/C=CN/ST=Shanghai/L=Shanghai/O=LynxChina/OU=lynxchina/CN=localhost"
```

> 通过局域网 IP（如 `192.168.x.x`）访问时，证书 SAN 不包含该 IP，仍会因主机名校验失败。
> 需要为该 IP 单独签一张证书，或把 App 协议临时切到 `http`。

##### 历史生成方式（rootCA 签发）

`rootCA.crt` / `rootCA.key` 是早期签发链，`rootCA.key` 带口令，当前不再用于日常重签，保留仅作兼容。

##### 生成根 CA 的私钥

```bash
openssl genrsa -out rootCA.key 2048
```

##### 使用私钥生成根 CA 的证书

```bash
openssl req -x509 -new -nodes -key rootCA.key -sha256 -days 1024 -out rootCA.crt
```

##### 生成 IP 的私钥

```bash
openssl genrsa -out ip.key 2048
```

##### 使用私钥生成证书请求文件

```bash
openssl req -new -key ip.key -out ip.csr
```

##### 创建证书扩展文件

```bash
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
IP.1 = 10.12.0.2
```

##### 使用根 CA 为 IP 签发证书

```bash
openssl x509 -req -in ip.csr -CA rootCA.crt -CAkey rootCA.key -CAcreateserial -out ip.crt -days 500 -sha256 -extfile v3.ext
```
