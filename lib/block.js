/**
 * 区块信息结构
 *
 * {
 *      "id": "sha256hash <- signs_fields + [ index, prev_blockid, entry_signs ]",
 *      "index": 0, #区块链序号
 *      "version": 1, #版本号
 *      "prev_blockid": "前一块区域链的序号",
 *      "timestamp": "交易生成时间戳",
 *      "existent_entries": [ "本次交易必须存在的账户" ],
 *      "nonexistent_entries": [ "本次交易必须不存在的账户" ],
 *      "out_entries": [ "本次交易需要资源转出的账户" ],
 *      "in_entries": [ "本次交易需要资源转入的账户" ],
 *      "script": "base64编码的交易脚本",
 *      "remark": "本次交易的交易文字描述",
 *      "signs_fields": [ #参与签名的字段列表, 至少要包括示例中的字段
 *          "version", "timestamp",
 *          "existent_entries", "nonexistent_entries",
 *          "out_entries", "in_entries", "script"
 *      ],
 *      "hash": "本次交易的哈希特征值，通过signs_fields计算得出",
 *      "entry_signs": [ #所有的out_entries必须参与签名
 *          {#第一个out_entry
 *              "entry": "账户",
 *              "sign": "签名"
 *          },
 *          {#第二个out_entry
 *              "entry": "账户",
 *              "sign": "签名"
 *          },
 *      ],
 *      "close_time": 入链时间戳,
 *      "sign": "挂链结点的签名，对id签名",
 *      "node_uuid": "挂链结点的uuid",
 *      "node_cert": "base64编码挂链结点的公钥证书"
 * }
 *
 * 哈希方式是 各字段的JSON.stringify结果然后使用|连接，再求sha256
*/

var fs = require("fs");

var db2 = require("berkeleydb");

var pki = require("./pki.js");

var opts = { json: true, encoding: "utf-8" };

var local = {
};

exports.init = function() {
    fs.mkdir("./data", function() { });

    if (global.__dbenv == null)
    {
        global.__dbenv = new db2.DbEnv();
        global.__dbenv.open("./data");
    }

    local.indexDb = new db2.Db(global.__dbenv);
    local.blockDb = new db2.Db(global.__dbenv);
    local.openDb = new db2.Db(global.__dbenv);

    local.indexDb.open("index.db");
    local.blockDb.open("block.db");
    local.openDb.open("open.db");

    local.cacheStatus = [ ];
};

/**
* 获取当前区块链的最后的序号
*/
exports.index = function() {
    var value = local.indexDb.get("index", opts) || 0;

    return value;
};

/**
 * 获取指定序号的区块id
*/
exports.blockId = function(index) {
    var blockId = local.indexDb.get(String(index), opts);

    return blockId;
};

/**
 * 获取指定交易哈希的区块id
*/
exports.blockIdFromHash = function(hash) {
    var blockId = local.indexDb.get(hash, opts);

    return blockId;
};


/**
 * 获取指定区块id的区块信息
*/
exports.block = function(blockId) {
    var block = local.blockDb.get(blockId, opts);

    return block;
};

/**
 * 获取指定序号的区块信息
 *
 * @param index 指定序号
 * @retval 区块信息
*/
exports.blockFromIndex = function(index) {
    var blockId = exports.blockId(index);

    if (blockId == null)
        return null;

    return exports.block(blockId);
};

/**
 * 将一个区块 写入数据库
*/
exports.write = function(block) {
    block = JSON.parse(JSON.stringify(block));

    delete block._internal;

    var topIndex = exports.index() + 1;

    if (topIndex != block.index)
    {console.log(`wrong index ${topIndex} != ${block.index}`);
        throw `wrong index ${topIndex} != ${block.index}`;
    }

    local.indexDb.put("index", block.index, opts);
    local.indexDb.put(String(block.index), block.id, opts);
    local.indexDb.put(block.hash, block.id, opts);

    local.blockDb.put(block.id, block, opts);
};

/**
 * 获取所有候选集数据
*/
exports.open = function() {
    var blocks = [ ];

    var cursor = new db2.DbCursor(local.openDb);

    var tuple = cursor.first(opts);

    if (tuple.key != null)
    {
        blocks.push(tuple.value);

        do
        {
            tuple = cursor.next(opts);

            if (tuple.key == null)
                break;

            blocks.push(tuple.value);
        } while(true);
    }

    cursor.close();

    return blocks;
};

/**
 * 从候选集中获取区块信息 
*/
exports.openFromHash = function(hash) {
    var block = local.openDb.get(hash, opts);

    return block;
};

/**
 * 将区块信息写入候选集
*/
exports.writeInOpen = function(block) {
    local.openDb.put(block.hash, block, opts);

    return block;
};

/**
 * 从候选集中删除一个区块信息
*/
exports.deleteFromOpen = function(hash) {
    local.openDb.del(hash);
};

/**
 * 将一个区块的信息规格化
*/
exports.normalize = function(block) {
    block.version = block.version || 1;
    block.existent_entries = block.existent_entries || [ ];
    block.nonexistent_entries = block.nonexistent_entries || [ ];
    block.out_entries = block.out_entries || [ ];
    block.in_entries = block.in_entries || [ ];

    block.script = block.script || "";

    block.signs_fields = block.signs_fields || [ ];

    /** 将 参与签名字段 和 必签字段 求 并集 */
    block.signs_fields =
        block.signs_fields.concat([
            "version", "timestamp",
            "existent_entries", "nonexistent_entries",
            "out_entries", "in_entries", "script"
        ].filter(function(item) {
            return !block.signs_fields.includes(item);
        }));

    block.entry_signs = block.entry_signs || [ ];

    return block;
};

/**
 * 将一个区块挂靠到链上
*/
exports.attach = function(block) {
    block.index = exports.index() + 1;
    block.prev_blockid = exports.blockId(block.index - 1);

    block.close_time = Date.now();
    block.node_uuid = config.node.uuid;
    block.node_cert = config.certs.cert.toString("base64");

    var fields = [
        "index", "version", "prev_blockid", "entry_signs"
    ].concat(block.signs_fields);

    var digest = pki.digest(block, fields);

    block.id = new Buffer(digest.digest().getBytes()).toString("hex");

    block.sign =
        new Buffer(pki.signIt(digest, config.certs.key, config.node)).toString("base64");

    return block;
};

/**
 * 验证区块的结点签名
*/
exports.verifySign = function(block) {
    var node_cert = new Buffer(block.node_cert, "base64")

    var err = pki.verifyCert(config.certs.ca, node_cert, block.node_uuid);
    if (err != null)
        return err;

    var fields = [
        "index", "version", "prev_blockid", "entry_signs"
    ].concat(block.signs_fields);

    var digest = pki.digest(block, fields);

    err = pki.verifyItsSign(digest, node_cert, block.sign);

    return err;
};

/**
 * 保存区块处理意见
*/
exports.cacheStatus = function(hash, message) {
    local.cacheStatus.push({
        hash: hash,
        message: message
    });

    if (local.cacheStatus.length > config.opts.statusCache)
    {
        local.cacheStatus.splice(
            0, local.cacheStatus.length - config.opts.statusCache);
    }
};

/**
 * 查询区块处理意见 
*/
exports.blockStatus = function(hash) {
    var item = local.cacheStatus.find(function(item) {
        return item.hash == hash;
    });

    if (item != null)
        return item.message;

    if (exports.blockIdFromHash(hash) != null)
        return "ok";

    if (exports.openFromHash(hash) != null)
        return "pending";

    return null;
};
