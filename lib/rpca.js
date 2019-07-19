/**
 * RPCA协议
 *
 * 定时同步交易:
 * 1) 遍历当前所有UNLS中结点，获取最新 区块链信息
 * 1.1) 计算其中最多数的 区块链信息
 * 2) 对比 本地 区块链信息，如果 本地信息 较旧，则开始进行同步
 * 2.1) 将本地服务节点状态 置为 同步，不参与新的协商
 * 2.2) 选择其中一个节点，一个一个区块地同步区块链数据
 * 2.3) 将本地服务节点状态 置为 正常，可以参与新的协商
 * 
 * 协商交易:
 * 1) 客户端 或者 服务代理 提交一个 交易
 * 1.1) 对交易规格化
 * 1.2) 查询 本地区域链中是否已经入库 或者 已经 入候选集。如是，则抛弃该交易数据
 * 1.3) 对交易进行验证，失败则抛弃交易数据
 * 1.4) 将交易写入候选集，并且标记本地投票yes, 初始化ttl
 *
 * 2) 定时向其它UNLS结点广播当前候选集
 * 2.1) 当接收到其它结点的候选集
 * 2.2) 查询 本地区域链中是否已经入库。如是，则抛弃该交易数据
 * 2.3) 查询 是否已经入候选集。如是，标记 来源结点 投票yes。处理完成。
 * 2.4) 对交易规格化
 * 2.5) 对交易进行验证，失败则抛弃交易数据
 * 2.6) 将交易写入候选集，并且标记 本地及来源结点 投票yes, 初始化ttl
 *
 * 3) 定时检查候选集
 * 3.1) 检查已经同步过后的本地区块链，预备候选区块是否已经入库。是，清除预候选区块信息。
 * 3.2) 如果 候选区域 达到 关闭阈值以上，则准备提交 预备关闭
 * 3.2.1) 如果 当前有预备关闭 区块，则等下一回合
 * 3.2.2) 如果 当前没有预备关闭 区块，挂载入区域链，然后标记为 预备关闭
 * 3.3) 如果 没有达到 关闭阈值，则等下一回合
 * 
 * 4) 定时检查预备关闭区块
 * 4.1) 检查已经同步过后的本地区块链，预备关闭区块是否已经入库。是，清除预备关闭区块。
 * 4.2) 收集其它结点的预备关闭区块，计算最大多数区块。
 * 4.3) 如果有最大多数，且与 当前结点 预备关闭区块 呈 竞争关系。则考虑替换，
 * 4.3.1) 该最大多数，存在于 本地候选集中，且超过关闭阈值，则替换，
 * 4.3.2) 否则 忽略。
 * 4.4) 当前结点 预备关闭区块 超过 关闭阈值。写入本地区块链。
 * 4.5) 标记 预备关闭区块 为 已关闭状态
*/

var u = require("url");
var q = require("bluebird");

var endpoint = require("./endpoint.js");
var unls = require("./unls.js");
var utils = require("./utils.js");
var block = require("./block.js");
var script = require("./script.js");

var local = { };

var checkSync = function() {
    var nodes = unls.nodes("healthy");

    var toplist = utils.bolshevik(nodes, function(node) {
        return `${node.stat.index}-${node.stat.blockid}`;
    });

    if (toplist.length <= 0 || toplist[0].getting < 0.8)
        return;

    var topone = toplist[0];

    if (topone.items[0].stat.index > block.index())
        sync(topone);
};

var sync = function(topone) {
    if (config.node.status == "syncing")
        return;

    var startIndex = block.index() + 1;
    var lastIndex = topone.items[0].stat.index;

    console.log("start");
    config.node.status = "syncing";

    var promise = q.resolve({ });

    for(var index = startIndex; index <= lastIndex; ++index)
    {
        promise = (function(index, promise) {
            promise = promise.then(function() {
                return new q.Promise(function(resolve, reject) {
                    var promise = q.reject({ });

                    for(var node_index in topone.items)
                    {
                        promise = (function(node_index, promise) {
                            promise = promise.then(() => { }, function() {
                                console.log(`sync ${index}`);

                                return endpoint.request(topone.items[node_index], u.format({
                                        pathname: "/block",
                                        query: {
                                            index: index
                                        }
                                    })).then(function(response) {
                                        var blk = response.data.result;

                                        console.log(`synced ${index} - ${blk.index}`);

                                        try
                                        {
                                            block.write(blk);
                                            script.run(blk);
                                        } catch(err)
                                        {
                                            console.error(err);
                                        }

                                        resolve({ });
                                    });                                
                            });

                            return promise;
                        })(node_index, promise);
                    }
                });
            });

            return promise;
        })(index, promise);
    }

    promise.then(function() {
        console.log("finish");

        local.preclose = null;
        config.node.status = "healthy";

        if (exports.hasPreclose())
            local.preclose = null;
    });
};

var voteRound = function() {
    if (config.node.status != "healthy")
        return;
        
    var blks = block.open();
    if (blks.length == 0)
        return;
        
    var nodes = unls.nodes("healthy");

    var nodesMap = { };

    nodes.forEach(function(node) {
        //向其它结点，提交本地候选集
        nodesMap[node.uuid] = node;

        //过滤掉 对方节点 已经喊 yes的区块
        var target_blks = blks.filter(function(blk) {
            return !(blk._internal.votes[node.uuid] == true);
        });

        endpoint.request(node, "/candidate", "POST", blks);
    });

    //结点总数量 = 健康结点数 + 本地结点
    var count = nodes.length + 1;

    blks.forEach(function(blk) {
        var voteCnt = Object.keys(blk._internal.votes).filter(function(uuid) {
            return (uuid == config.node.uuid || nodesMap[uuid] != null);
        }).length;

        blk._internal.getting = voteCnt / count;

        if (blk._internal.getting >= config.opts.closeThreshold)
        {
            if (!exports.hasPreclose())
            {//预关闭前，再验证一次
                var err = script.verify(blk);
                if (err != null)
                {
                    block.cacheStatus(blk.hash, err);
                    block.deleteFromOpen(blk.hash);
                    return err;
                }

                block.attach(blk);

                local.preclose = blk;
                local.preclose._internal.status = "preclose";

                console.log(`preclose ${local.preclose._internal.getting} ${local.preclose.id}`);
            }
        } else
        {
            --blk._internal.ttl;
        }

        if (blk._internal.ttl <= 0)
        {
            block.deleteFromOpen(blk.hash);

            block.cacheStatus(blk.hash, "discard because of ttl limit");
            return;
        }

        block.writeInOpen(blk);
    });
};

var replacePreclose = function(remote_preclose) {
    if (remote_preclose.index != block.index() + 1)
        return;

    var blk = block.openFromHash(remote_preclose.hash);
    
    if (blk == null || blk._internal.getting < config.opts.closeThreshold)
        return;

    var err = script.verify(blk);
    if (err != null)
    {//替换预关闭前，再验证一次
        block.cacheStatus(blk.hash, err);
        block.deleteFromOpen(blk.hash);
        return err;
    }

    Object.assign(blk, remote_preclose);

    block.writeInOpen(blk);

    local.preclose = blk;
    local.preclose._internal.status = "preclose";

    console.log(`change preclose ${local.preclose._internal.getting} ${local.preclose.id}`);
};

var closeBlock = function() {
    if (block.blockIdFromHash(local.preclose.hash) == null)
    {
        block.write(local.preclose);
        script.run(local.preclose);
    }

    local.preclose._internal.status = "closed";

    block.deleteFromOpen(local.preclose.hash);
};

var closeRound = function() {
    if (config.node.status != "healthy")
        return;

    if (exports.hasPreclose() &&
        block.blockIdFromHash(local.preclose.hash) != null)
    {
        console.log(`${local.preclose.id} exists hash ${local.preclose.hash}. ignore it.`);

        block.deleteFromOpen(local.preclose.hash);
        local.preclose = null;
        return;
    }

    var nodes = unls.nodes("healthy");
    if (nodes.length <= 0)
    {//独狼结点 直接写入数据库
        if (exports.hasPreclose())
        {
            console.log(`single wolf ${local.preclose.id}`);
            closeBlock();
        }
        return;
    }

    var toplist = utils.bolshevik(nodes, function(node) {
        if (node.stat.preclose == null)
            return "";

        return `${node.stat.preclose.id}`;
    });

    var topone = toplist[0];
    if (topone.items[0].stat.preclose == null)
        return;

    var remote_preclose = topone.items[0].stat.preclose;

    if (!exports.hasPreclose() ||
        (remote_preclose.id != local.preclose.id &&
         remote_preclose.index == local.preclose.index &&
         remote_preclose.prev_blockid == local.preclose.prev_blockid))
    {
        topone.items.forEach(function(node) {
            node.stat._refresh = true;
        });

        replacePreclose(remote_preclose);
        return;
    }

    if (exports.hasPreclose() && (remote_preclose.id == local.preclose.id))
    {
        if (nodes.findIndex(function(node) {
                return node.stat._refresh == true;
            }) != -1)
        {
            console.log(`wait for refresh.`);
        }

        //真实比率 需要把 本地结点 计算进去
        var real_getting =
            ((topone.getting * nodes.length) + 1) / (nodes.length + 1);

        if (real_getting >= config.opts.closeThreshold)
        {//如果大于 阈值 则写入结点
            console.log(`commit ${real_getting} ${local.preclose.id}`);
            closeBlock();
        }
    }
};

exports.init = function() {
    //区块链同步检查
    local.syncTimer = setInterval(checkSync, config.opts.syncTimer);

    //投票回合
    local.voteTimer = setInterval(voteRound, config.opts.roundTimer);
    local.roundTimer = setInterval(closeRound, config.opts.roundTimer);

    {//调取最后一条区块, 作为最新关闭区块数据
        var blk = block.blockFromIndex(block.index());

        if (blk != null)
        {
            local.preclose = blk;
            local.preclose._internal = {
                status: "closed"
            };
        }
    }

    config.node.status = "healthy";
};

exports.reload = function() {
    clearInterval(local.syncTimer);
    
    clearInterval(local.voteTimer);
    clearInterval(local.roundTimer);

    exports.init();
};

//提交一个交易
exports.commit = function(blk) {
    block.normalize(blk);

    if (blk.nonexistent_entries.length == 0 &&
        blk.out_entries.length == 0)
    {
        return `empty block isn't allow.`;
    }

    if (block.blockIdFromHash(blk.hash) != null ||
        block.openFromHash(blk.hash) != null)
    {
        return `block ${blk.hash} has exists.`;
    }

    var err = script.verify(blk);
    if (err != null)
    {
        block.cacheStatus(blk.hash, err);
        return err;
    }

    blk._internal = {
        ttl: config.opts.ttl,
        votes: { },
        getting: 0
    };

    blk._internal.votes[config.node.uuid] = true;

    block.writeInOpen(blk);

    return null;
};

//收到广播候选集
exports.candidate = function(node_uuid, blk) {
    if (block.blockIdFromHash(blk.hash) != null)
        return `block ${blk.hash} has exists.`;

    var local_block = block.openFromHash(blk.hash);
    if (local_block == null)
    {
        var err = exports.commit(blk);
        if (err != null)
            return err;
    } else
    blk = local_block;

    blk._internal.votes[node_uuid] = true;

    block.writeInOpen(blk);

    return null;
};

exports.hasPreclose = function() {
    return (
        local.preclose != null &&
        local.preclose._internal.status != "closed"
    );
};

//返回预备提交区块
exports.preclose = function() {
    if (local.preclose == null)
        return null;
    
    return {
        id: local.preclose.id,
        index: local.preclose.index,
        hash: local.preclose.hash,
        prev_blockid: local.preclose.prev_blockid,
        close_time: local.preclose.close_time,
        node_uuid: local.preclose.node_uuid,
        node_cert: local.preclose.node_cert,
        sign: local.preclose.sign,
        _internal: local.preclose._internal
    };
};
