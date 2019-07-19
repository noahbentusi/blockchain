var q = require("bluebird");

/** 初始化全局配置 */
var config = require("./lib/config.js");

/** 网络接口 */
var endpoint = require("./lib/endpoint.js");

/** UNL结点集群管理 */
var unls = require("./lib/unls.js");

/** 密钥证书及签名验签工具类 */
var pki = require("./lib/pki.js");

/** 区块链数据库 */
var block = require("./lib/block.js");

/** 信息数据库 */
var data = require("./lib/data.js");

/** 同步协商协议 */
var rpca = require("./lib/rpca.js");

q.resolve(null)
    .then(config.init)
    .then(block.init)
    .then(data.init)
    .done(function() {
        var entry = data.entry("e695fb06-a9e7-11e9-9666-a78541c3a0d8");

        console.log(pki.verifyCert(global.config.certs.golden_ca, new Buffer(entry.cert.value, "base64"), entry.id));
    });
