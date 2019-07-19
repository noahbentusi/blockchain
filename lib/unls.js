var q = require("bluebird");
var fs = require("fs");

var endpoint = require("./endpoint.js");
var pki = require("./pki.js");

var nodes = null;

var local = { };

var checkNode = function(node, stat, resolve, reject) {
    if (node.uuid != stat.uuid)
    {
        return reject(`mismatch uuid ${node.uuid} != ${stat.uuid}`);
    }

    var err =
        pki.verifyCert(
            config.certs.ca,
            new Buffer(stat.cert, "base64"));

    if (err != null)
    {
        return reject(result);
    }

    resolve(stat);
};

var checkHealthy = function() {
    nodes.every(function(node) {
        (function(node) {
            return new q.Promise(function(resolve, reject) {

                endpoint.request(node, "/healthy")
                    .then(function(res) {
                        if (res.statusCode != 200)
                        {
                            return reject(res.statusMessage);
                        }

                        checkNode(node, res.data, resolve, reject);
                    }, function(err) {
                        reject(err);
                    });
            });
        })(node).then(function(stat) {
            node.status = stat.status || "healthy";
            node.stat = stat;

            if (stat.cert != node.rawCert)
            {
                node.rawCert = stat.cert;
                node.cert = new Buffer(stat.cert, "base64");
            }

            node.timestamp = Date.now();
        }, function(err) {
            node.status = "fault";
            node.reason = String(err);
            node.timestamp = Date.now();
        });

        return true;
    });
}

exports.init = function(daemon) {
    if (daemon == null)
        daemon = true;

    nodes = Array.from(config.unl.filter(function(node) {
        if (node.uuid == config.node.uuid)
            return false;

        return true;
    }));

    nodes.every(function(node) {
        node.status = "healthy";
        node.stat = {
            _refresh: true
        };

        return true;
    });

    if (daemon)
    {//服务节点健康检查
        local.healthyTimer = setInterval(checkHealthy, config.opts.healthyTimer);
    }
};

exports.reload = function() {
    clearInterval(local.healthyTimer);

    exports.init();
};

exports.count = function(status) {
    return nodes.reduce(function(value, node) {
        if (status == null || node.status == status)
            return value + 1;

        return value;
    }, 0);
};

exports.nodes = function(status) {
    return nodes.filter(function(node) {
        return  (status == null || node.status == status);
    });
};

exports.node = function(uuid) {
    for(var index in nodes)
    {
        var node = nodes[index];

        if (node.uuid == uuid)
            return node;
    }

    return null;
};
