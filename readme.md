#生成根密钥
openssl genrsa -des3 -out root.key 4096

#生成根证书
openssl req -new -x509 -key root.key -out root.crt


#结点1密钥
openssl genrsa -out node1.key 4096

#生成 结点1 证书请求
openssl req -new -key node1.key -out node1.csr

#使用根密钥签名 结点1 证书
openssl x509 -req -days 365 -in node1.csr -CA root.crt -CAkey root.key -set_serial 01 -out node1.crt


#显示证书内容
openssl x509 -in node1.crt -noout -text

#转换私钥
openssl rsa -in privatekey.pem -out privatekey.pvk -outform PVK

const v4 = new RegExp(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i);

console.log(generateId().match(v4));



https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy
https://en.wikipedia.org/wiki/Brooks%E2%80%93Iyengar_algorithm

