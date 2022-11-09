#! /bin/bash

cd ../static
rm -rf ./crt/*
mkdir crt
cd crt
openssl req -new -newkey rsa:2048 -nodes -out lynx.csr -keyout private.key
openssl x509 -req -days 365 -in lynx.csr -signkey private.key -out lynx.crt