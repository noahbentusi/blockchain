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
    .then(endpoint.init)
    .then(unls.init)
    .then(data.init)
    .then(rpca.init)
    .done(function() {        
        process.on('uncaughtException', function(err) {
        　　console.error(`${err}\n${err.stack}`);
        });

        console.log("ready.");
    });
