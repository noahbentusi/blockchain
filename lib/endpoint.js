var fs = require("fs");
var https = require("https");
var p = require("path");
var u = require("url");

var q = require("bluebird");

var iconv = require('iconv-lite');
var mime = require("content-type-parser");

var cfg = require("./config.js");
var unls = require("./unls.js");
var block = require("./block.js");
var rpca = require("./rpca.js");
var pki = require("./pki.js");

var tlsOpt = function() {
    return {
        requestCert: true,
        rejectUnauthorized: true,
        key: config.certs.key,
        cert: config.certs.cert,
        ca: [ 
            config.certs.ca
        ],
        timeout: config.opts.timeout
    };
};

var handlers = {
};

var local = {
};

exports.init = function() {
    var server = https.createServer(tlsOpt(), function(request, response) {
        var chunkList = [ ];

        request.on('data', function(chunk) { 
            chunkList.push(chunk);
        });

        request.on('end', function(data) {
            request.url = u.parse(request.url, true);
            request.data = Buffer.concat(chunkList);

            var contentType =
                mime(request.headers['content-type'] || "text/html; charset=utf-8");

            if (contentType.type == "text" ||
                (contentType.type == "application" && contentType.subtype == "json"))
            {
                request.data = iconv.decode(
                    request.data, contentType.get("charset") || "utf-8");

                if (contentType.subtype == "json")
                {
                    var result = false;
                    
                    request.data = JSON.parse(request.data);

                    if (request.data.sign != null)
                    {
                        result =
                            pki.verifySign(
                                [
                                    JSON.stringify(request.data.result),
                                    JSON.stringify(request.data.timestamp)
                                ].join("|"),
                                Buffer.from(request.data.cert, "base64"),
                                Buffer.from(request.data.sign, "base64").toString(),
                                {
                                    uuid: request.data.node_uuid
                                });
                    }

                    if (!result)
                    {
                        response.statusCode = 400;
                        response.statusMessage = result;
                        response.end();

                        return ;
                    }
                }
            }

            var action = p.basename(request.url.pathname);

            var handler = handlers[action];

            if (handler != null)
            {
                return handler(request, response);
            }

            response.statusCode = 404;
            response.end();
        });
    });

    server.listen({
        host: config.endpoint.host,
        port: config.endpoint.port,
        backlog: config.endpoint.backlog
    });

    local.server = server;
};

exports.reload = function() {
    local.server.close(function() {
        exports.init();
    });
};

/**
 * 向指定节点发送请求
 *
 * @param node 节点对象, 从unls模块中获取
 * @param path 请求路径
 * @param method 可选，默认为 GET
 * @param data 可选，请求Body
 * @param headers 可选，请求的headers
 *
 * @retval 返回值为一个 promise对象
*/
exports.request = function(node, path, method, data, headers) {
    method = method || "GET";
    headers = headers || { };

    return new q.Promise(function(resolve, reject) {
        if (data != null && !Buffer.isBuffer(data))
        {
            headers["content-type"] = "application/json; charset=utf-8";

            var postData = {
                node_uuid: config.node.uuid,
                cert: config.certs.cert.toString("base64"),
                result: data
            };

            data = sign(postData);
        }

        var opt = Object.assign({
            host: node.host,
            port: node.port,
            method: method,
            path: path,
            headers: headers,
            "servername": node.uuid
        }, tlsOpt());

        var client = https.request(opt, function(res) {
            var contentType =
                mime(res.headers['content-type'] || "text/html; charset=utf-8");

            var chunkList = [ ];

            res.on('data', function(chunk) {
                chunkList.push(chunk);
            });

            res.on('end', function(data) {
                res.rawData = res.data = Buffer.concat(chunkList);

                if (contentType.type == "text" ||
                    (contentType.type == "application" && contentType.subtype == "json"))
                {
                    res.data = iconv.decode(
                        res.data, contentType.get("charset") || "utf-8");

                    if (contentType.subtype == "json")
                    {
                        res.data = JSON.parse(res.data);

                        if (res.data.result != null)
                        {
                            var result =
                                pki.verifySign(
                                    [
                                        JSON.stringify(res.data.result),
                                        JSON.stringify(res.data.timestamp)
                                    ].join("|"), node.cert,
                                    Buffer.from(res.data.sign, "base64").toString(),
                                    node);

                            if (!result)
                            {
                                return reject("failed to verify sign.");
                            }
                        }
                    }
                }

                resolve(res);
            });
        });

        if (config.opts.timeout != null)
        {
            client.on('socket', function (socket) {
                socket.setTimeout(config.opts.timeout);

                socket.on('timeout', function() {
                    client.abort();
                });
            });
        }

        client.on("error", function(e) {
            reject(e);
        });

        if (data != null)
            client.write(data);

        client.end();
    });
};


var sign = function(result) {
    result.timestamp = Date.now();
    result.sign =
        Buffer.from(
            pki.sign([
                JSON.stringify(result.result),
                JSON.stringify(result.timestamp)
            ].join("|"), config.certs.key, config.node)
        ).toString("base64");

    return JSON.stringify(result);
};

//各个action的处理器

//返回结点当前的状态
handlers.healthy = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");

    var index = block.index();
    var blockId = block.blockId(index);

    var stat = {
        uuid: config.node.uuid,
        cert: config.certs.cert.toString("base64"),
        index: index,
        blockid: blockId,
        preclose: rpca.preclose(),
        status: config.node.status        
    };

    response.end(JSON.stringify(stat));
};

//返回结点所获取的各节点的状态
handlers.nodes = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");

    var nodes = unls.nodes().map(function(node) {
        return {
            "uuid": node.uuid,
            "status": node.status,
            "reason": node.reason,
            "index": node.index,
            "blockid": node.blockid,
            "timestamp": node.timestamp
        };
    });

    var result = {
        status: 200,
        result: nodes
    };

    response.end(sign(result));
};

//返回当前结点使用的ca
handlers.ca = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    
    var result = {
        status: 200,
        result: config.certs.ca.toString("base64")
    };

    response.end(sign(result));
};

//计算一个新entry相关数据
handlers.news = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    
    var result = {
        status: 200
    };

    try
    {
        result.result = pki.generateEntry(
            request.url.query["id"],
            request.url.query["password"],
            request.url.query["email"]
        );
    } catch(err)
    {
        result.status = 400;
        result.message = err;
    }

    response.end(sign(result));
};

//返回一个区块信息
handlers.block = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    
    var result = {
        status: 200
    };
    
    var index = request.url.query["index"];

    if (index != null)
    {
        var blockId = block.blockId(index);

        result.result = block.block(blockId);
    } else
    {
        var blockId = request.url.query["blockId"];

        result.result = block.block(blockId);
    }

    response.end(sign(result));
};

//接收提交交易
handlers.commit = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");

    var result = {
        status: 200,
        result: `pending. hash ${request.data.result.hash}`
    };

    var err = rpca.commit(request.data.result);
    if (err != null)
    {
        result.status = 400;
        result.result = err;
    }

    response.end(sign(result));
}

//接收候选集
handlers.candidate = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");

    var result = {
        status: 200
    };

    var node_uuid = request.data.node_uuid;
    var candidates = request.data.result;

    result.result = { };

    var node = unls.node(node_uuid);

    if (node != null && node.status == "healthy")
    {
        candidates.every(function(block) {
            var err = rpca.candidate(node_uuid, block);

            if (err != null)
                result.result[block.hash] = err;

            return true;
        });
    }

    response.end(sign(result));
};

//查询交易处理状态
handlers.txnstatus = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");

    var result = {
        status: 200
    };

    var hash = request.url.query["hash"];

    var message = block.blockStatus(hash);

    result.result = message;

    response.end(sign(result));
};

//重新加载配置
handlers.reload = function(request, response) {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");

    var result = {
        status: 200,
        result: "ok"
    };

    if (config.node.status != "healthy")
    {
        result.status = 403;
        result.result = `can't reload because of status '${config.node.status}.'`;

        return response.end(sign(result));;
    }

    q.resolve(null)
        .then(cfg.init)
        .then(unls.reload)
        .then(rpca.reload)
        .then(exports.reload)
        .done(function() {
            result.result = config;

            response.end(sign(result));
        });
};
