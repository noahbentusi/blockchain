var fs = require("fs");
var u = require("url");
var q = require("bluebird");

var argv = require("attrs.argv");

/** 初始化全局配置 */
var config = require("./lib/config.js");
var endpoint = require("./lib/endpoint.js");
var block = require("./lib/block.js");
var unls = require("./lib/unls.js");
var pki = require("./lib/pki.js");

var comment_regex = /(\/\*){1}.*(\*\/){1}/g;

var txn_template = `{
      "version": 1,
      "existent_entries": [ /** 本次交易必须存在的账户 */ ],
      "nonexistent_entries": [ /** 本次交易必须不存在的账户 */ ],
      "out_entries": [ /** 本次交易需要资源转出的账户 */ ],
      "in_entries": [ /** 本次交易需要资源转入的账户 */ ],
      "remark": "本次交易的交易文字描述",
      "signs_fields": [
          "version", "timestamp",
          "existent_entries", "nonexistent_entries",
          "out_entries", "in_entries", "script"
      ]
}
`;

var txn_js = `/**
javascript api:

# 1. 创建账户

createEntry(entryId, { //自定义字段
    "字段名称": "字段类型"
});

系统会默认在账户上建立基础的系统字段如下:
* id: string 账户id
* name: string 账户人的名字
* cert: string base64格式的账户公钥证书
* balance: balance 默认的账户余额

函数会返回账户对象

# 2. 获取账户对象

entry(id);

获取的账户必须出现在out_entries或nonexistent_entries中。

# 3. 赋值

直接对象的字段赋值就可以。但是被赋值的账户必须出现在out_entries中。

# 4. 转账 

transfer(src_id, target_id, "field_name", amount);

src_id 资金转出账户id
target_id 资金转入账户id
"field_name" 资金字段
amount 资金金额

# 5. 当前区块信息数据

block();

所有属性都是只读的

字段类型:

number 数值类型
string 字符串类型
balance 资金类型
array 数组类型

*/
`;

var def = function(func, message) {
    func.message = message || "";

    return func;
};

var getNode = function(nodeInd) {
    if (nodeInd == null)
        nodeInd = 0;

    var index = Number(nodeInd);

    if (!isNaN(index))
        return unls.nodes()[index];

    return unls.node(nodeInd);
};

var fetchNodeHealthy = function(node) {
    return function() {
        return endpoint.request(node, "/healthy")
            .then(function(response) {
                node.cert = new Buffer(response.data.cert, "base64");

                return response;
            }, function(err) {
                console.error(err);
            });
    };
};

var actions = {
    "help": def(() => {
        console.log(`client for blockchain v0.1\n`);

        console.log(`Actions:`);

        
        var keyname = Buffer.alloc(12, ' ');
        
        for(var key in actions)
        {
            keyname.fill(' ');
            keyname.write(key, 0);

            console.log(`\t--action ${keyname}\t${actions[key].message}`);
        }

        console.log(`\n© 2019 51ods.com.`);
    }, "help message"),

    "list-nodes": def(() => {
        var nodes = unls.nodes();

        console.log("index\tnode-uuid\thost\tport");

        nodes.every(function(node, index) {
            console.log(`${index}\t${node.uuid}\t${node.host}\t${node.port}`);

            return true;
        });
    }, "print all nodes."),

    "healthy": def(() => {
        var node = getNode(argv.node);
        if (node == null)
        {
            console.error(`node ${argv.node} not found`);
            return;
        }

        fetchNodeHealthy(node)()
            .then(function(response) {
                console.log(response.data);
            });
    }, `request healthy of specify node. 
\t    --node (index or uuid)  the index or uuid of specify node.
    `),

    "nodes": def(() => {
        var node = getNode(argv.node);
        if (node == null)
        {
            console.error(`node ${argv.node} not found`);
            return;
        }

        q.resolve({ })
            .then(fetchNodeHealthy(node))
            .then(function() {
                return endpoint.request(node, "/nodes")
                    .then(function(response) {
                        console.log(response.data);
                    }, function(err) {
                        console.error(err);
                    });
            });
    }, `request unls status of specify node.
\t    --node (index or uuid)  the index or uuid of specify node.
    `),

    "new-entry": def(() => {
        var node = getNode(argv.node);
        if (node == null)
        {
            console.error(`node ${argv.node} not found`);
            return;
        }

        var data = {
            id: argv.id,
            password: argv.password || "",
            email: argv.email || ""
        };

        var output = argv.output || "./";

        q.resolve({ })
            .then(fetchNodeHealthy(node))
            .then(function() {
                return endpoint.request(node, u.format({
                        pathname: "/news",
                        query: data
                    }))
                    .then(function(response) {
                        if (response.data.status != 200)
                        {
                            console.error(response.data);
                            return;
                        }

                        var entryId = response.data.result.entryId;
                        var cert = Buffer.from(response.data.result.cert, "base64");
                        var key = Buffer.from(response.data.result.key, "base64");

                        console.log(`your entryId is ${entryId}.`);

                        console.log(`save your private key into ${output}/${entryId}.key.`);
                        fs.writeFileSync(`${output}/${entryId}.key`, key);

                        console.log(`save your public key into ${output}/${entryId}.crt.`);
                        fs.writeFileSync(`${output}/${entryId}.crt`, cert);

                        console.log(`your public key: \n${response.data.result.cert}`);

                        console.log("ok!");
                    }, function(err) {
                        console.error(err);
                    });
            });
    }, `request the init information of new entry.
\t    --node (index or uuid)  the index or uuid of specify node.
\t    [ --id entryid ]        the id of entry.
\t    --password password     the password of entry.
\t    --email email           the email of entry
\t    --output outputdir      destination of the init information of new entry.
    `),

    "new-txn": def(() => {
        var output = argv.output || "./";

        var txn = argv.txn || "txn";

        txn = `${output}/${txn}`;

        console.log(`create template of transaction into ${txn}.json`);
        fs.writeFileSync(`${txn}.json`, txn_template, "utf-8");

        console.log(`create script of transaction into ${txn}.js`);
        fs.writeFileSync(`${txn}.js`, txn_js, "utf-8");
    }, `init transaction file where specify path.
\t    --txn name              name of transaction
\t    --output outputdir      destination of the init transaction file.
    `),

    "build-txn": def(() => {
        var txn = argv.txn || "./txn";

        var json =
            JSON.parse(fs.readFileSync(`${txn}.json`, "utf-8").replace(comment_regex, ""));
        var script = fs.readFileSync(`${txn}.js`);

        json = block.normalize(json);

        json.timestamp = Date.now();
        json.script = script.toString("base64");
        json.hash =
            Buffer.from(pki.digest(json, json.signs_fields).digest().getBytes()).toString("hex");

        console.log(`create transaction data into ${txn}.dat with hash ${json.hash}`);
        fs.writeFileSync(`${txn}.dat`, JSON.stringify(json, "", "    "), "utf-8");
    }, `build transaction
\t    --txn path              pathname of the transaction
    `),

    "sign-txn": def(() => {
        var txn = argv.txn || "./txn";

        var entryId = argv.id;
        var keyname = argv.key;
        var password = argv.password;

        var json = JSON.parse(fs.readFileSync(`${txn}.dat`, "utf-8"));

        var key = pki.loadPrivateKey(fs.readFileSync(`${keyname}`), password);
        if (key == null)
        {
            console.error(`missing private key or incorrect password`);
            return;
        }

        var digest = pki.digest(json, json.signs_fields);

        if (json.hash != Buffer.from(digest.digest().getBytes()).toString("hex"))
        {
            console.error(`incorrect hash of transaction ${txn}.dat`);
            return;
        }

        var entry_sign = json.entry_signs.find(function(entry_sign) {
            return entry_sign.entry == entryId;
        });

        if (entry_sign == null)
        {
            json.entry_signs.push(
                entry_sign = {
                    entry: entryId
                }
            );
        }

        entry_sign.sign = Buffer.from(pki.signIt(digest, key)).toString("hex");

        console.log(`update transaction data into ${txn}.dat with hash ${json.hash}`);
        fs.writeFileSync(`${txn}.dat`, JSON.stringify(json, "", "    "), "utf-8");
    }, `sign transaction
\t    --txn path              pathname of the transaction
\t    --id entryId            the id of entry
\t    --key pathname          pathname of the private key
\t    --password password     password of entry
    `),

    "txn-status": def(() => {
        var node = getNode(argv.node);
        if (node == null)
        {
            console.error(`node ${argv.node} not found`);
            return;
        }

        q.resolve({ })
            .then(fetchNodeHealthy(node))
            .then(function() {
                return endpoint.request(node, u.format({
                        pathname: "/txnstatus",
                        query: {
                            hash: argv.hash
                        }
                    }))
                    .then(function(response) {
                        console.log(response.data);
                    })
            });
    }, `request status of a transaction
\t    --node (index or uuid)  the index or uuid of specify node.
\t    --hash hash             the hash of transaction
    `),

    "commit-txn": def(() => {
        var node = getNode(argv.node);
        if (node == null)
        {
            console.error(`node ${argv.node} not found`);
            return;
        }

        var txn = argv.txn || "./txn";

        var json = JSON.parse(fs.readFileSync(`${txn}.dat`, "utf-8"));

        q.resolve({ })
            .then(fetchNodeHealthy(node))
            .then(function() {
                return endpoint.request(node, "/commit", "POST", json)
                    .then(function(response) {
                        console.log(response.data);
                    })
            });
    }, `commit transaction to node
\t    --node (index or uuid)  the index or uuid of specify node.
\t    --txn path              pathname of the transaction
    `),

    "reload": def(() => {
        var node = getNode(argv.node);
        if (node == null)
        {
            console.error(`node ${argv.node} not found`);
            return;
        }

        q.resolve({ })
            .then(fetchNodeHealthy(node))
            .then(function() {
                return endpoint.request(node, "/reload")
                    .then(function(response) {
                        console.log(response.data);
                    })
            });
    }, `notify node to reload config
\t    --node (index or uuid)  the index or uuid of specify node.
    `)
};

q.resolve({ })
    .then(function() {
        return config.init("./config/client.json");
    })
    .then(function() {
        return unls.init(false);
    })
    .done(function() {
        var key = argv.action;

        var action = actions[key] || actions["help"];

        action();
    });

