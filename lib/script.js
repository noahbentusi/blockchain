/**
script api:

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

var vm = require("vm");
var bignum = require("bn.js");

var data = require("./data.js");
var pki = require("./pki.js");

var small_figure_regex = /\.\d*/g;
var uuidRegexp = new RegExp(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

var types = {
    string: function() {
        return {
            type: "string",
            value: ""
        };
    },
    number: function() {
        return {
            type: "number",
            value: 0
        };
    },
    array: function() {
        return {
            type: "array",
            value: [ ]
        };
    },
    balance: function() {
        return {
            type: "balance",
            value: "0"
        };
    }
};

var tobn = function(num) {
    num = num || "0";
    num = String(num).replace(small_figure_regex, "");

    return new bignum(num);
};

var loadEntry = function(block, local) {
    block.out_entries.every(function(entryId) {
        var entry = local.entires[entryId] || data.entry(entryId);

        if (entry == null)
            throw `out entry ${entryId} not exists!`;

        local.entires[entryId] = entry;
        local.out_entries[entryId] = entry;

        return true;
    });

    block.in_entries.every(function(entryId) {
        var entry = local.entires[entryId] || data.entry(entryId);

        if (entry == null)
            throw `in entry ${entryId} not exists!`;

        local.entires[entryId] = entry;
        local.in_entries[entryId] = entry;

        return true;
    });
};

var verifySign = function(block, local) {
    var signs = { };

    var digest = pki.digest(block, block.signs_fields);

    var hash = new Buffer(digest.digest().getBytes()).toString("hex");
    if (hash != block.hash)
    {
        throw `failed to verify hash of block. ${hash} != ${block.hash}`;
    }

    block.entry_signs.every(function(item) {
        signs[item.entry] = item.sign;

        return true;
    });

    for(var entryId in local.out_entries)
    {
        var entry = local.out_entries[entryId];

        var sign = signs[entryId];
        if (sign == null)
            throw `out entry ${entryId} has no sign.`;

        var cert = Buffer.from(entry.cert.value, "base64");

        if (!pki.verifyItsSign(digest, cert, new Buffer(sign, "hex").toString(), entryId))
            throw `failed to verify signature of out entry ${entryId}.`;
    }
};

var checkEntryExistence = function(block, local) {
    block.nonexistent_entries.every(function(entryId) {
        if (data.entry(entryId) != null)
            throw `nonexistent entry ${entryId} has exists.`;

        return true;
    });

    block.existent_entries.every(function(entryId) {
        if (local.out_entries[entryId] != null ||
            local.in_entries[entryId] != null)
            return true;

        if (data.entry(entryId) == null)
            throw `existent entry ${entryId} not exists.`;

        return true;
    });
};

var OutEntryHandler = {
    get: function(entry, name) {
        if (entry[name] == null)
        {
            throw `entry ${entry.id} has no field ${name}.`;
        }

        return entry[name].value;
    },
    set: function(entry, name, value) {
        if (["id"].includes(name))
        {
            throw `entry ${entry.id} can't modify field ${name}.`;
        }

        if (entry[name] == null)
        {
            throw `entry ${entry.id} has no field ${name}.`;
        }

        var field = entry[name];

        if (field.type == "balance")
        {
            throw `entry ${entry.id} can't set balance field ${name} directly.`;
        }

        if (name == "cert")
        {
            if (value != null)
                value = String(value).trim();

            if (value == null || value == "" ||
                pki.verifyCert(config.certs.ca, new Buffer(value, "base64"), entry.id) != null)
            {
                throw `new entry ${entry.id} hasn't a correct cert.`;
            }
        }

        return field.value = value;
    }
};

var ReadOnlyHandler = {
    get: function(target, name) {
        return JSON.parse(JSON.stringify(target[name]));
    },
    set: function(target, name, value) {
        return value;
    }
};

var installApi = function(context, block, local) {
    context.createEntry = function(entryId, props) {
        props = props || [ ];

        if (!entryId.match(uuidRegexp))
            throw `entryId ${entryId} isn't a correct uuid.`;

        var entry = {
            id: entryId,
            name: types["string"](),
            cert: types["string"](),
            balance: types["balance"]()
        };

        for(var name in props)
        {
            var type = props[name];

            if (types[type] == null)
            {
                throw `type ${type} of field ${name} isn't supported.`;
            }

            entry[name] = types[type]();
        }

        local.new_entries[entryId] = entry;

        return new Proxy(entry, OutEntryHandler);
    };

    context.entry = function(entryId) {
        var entry = local.new_entries[entryId] || local.out_entries[entryId];

        if (entry == null)
        {
            throw `entry ${entryId} can't be fetch.`;
        }

        return new Proxy(entry, OutEntryHandler);
    };

    context.transfer = function(src_id, target_id, field_name, amount) {
        var out_entry = local.out_entries[src_id];
        var in_entry = local.in_entries[target_id];

        if (out_entry == null)
        {
            throw `out entry ${src_id} can't be fetch.`;
        }

        if (in_entry == null)
        {
            throw `in entry ${target_id} can't be fetch.`;
        }

        amount = tobn(amount);

        /** amount < 0 */
        if (amount.lte(tobn(0)))
        {
            throw `transfer amount ${amount} must be greater zero.`;
        }

        var left_field = out_entry[field_name];
        var right_field = in_entry[field_name];

        if (left_field == null || left_field.type != "balance")
            throw `out entry ${src_id} balance field ${field_name} not found`;

        if (right_field == null || right_field.type != "balance")
            throw `in entry ${target_id} balance field ${field_name} not found`;

        left_amount = tobn(left_field.value);
        right_amount = tobn(right_field.value);

        /** left_amount < amount */
        if (left_amount.lt(amount))
        {
            var pass = false;

            if (global.config.certs.golden_ca != null &&
                pki.verifyCert(
                    global.config.certs.golden_ca,
                    Buffer.from(out_entry.cert.value, "base64"),
                    out_entry.id) == null)
            {
                pass = true;
            }

            if (!pass)
                throw `out entry ${src_id} balance field ${field_name} not enough. ${left_amount} < ${amount}`;
        }

        left_amount = left_amount.sub(amount);
        right_amount = right_amount.add(amount);

        left_field.value = left_amount.toString();
        right_field.value = right_amount.toString();
    };

    context.block = function() {
        return new Proxy(block, ReadOnlyHandler);
    };
};

var verifyContext = function(block) {
    var local = {
        entires: { },
        new_entries: { },
        out_entries: { },
        in_entries: { }
    };

    var context = {
    };

    //第一步，加载所有out/in账户信息
    loadEntry(block, local);

    //第二步，先验证签名，判断所有out账户是否已经签名
    verifySign(block, local);

    //第三步，判断必须存在 和 不存在的账户
    checkEntryExistence(block, local);

    //第四步，模拟运行api
    installApi(context, block, local);

    //第五步，收尾检查
    context.check = function() {
        if (block.nonexistent_entries.length != 0)
        {//查看非存在账户是否都已经建立账户
            block.nonexistent_entries.forEach(function(entryId) {
                if (local.new_entries[entryId] == null)
                {
                    throw `nonexistent_entry ${entryId} didn't create entry`;
                }
            });
        }
    };

    return context;
};

var runContext = function(block) {
    var local = {
        entires: { },
        new_entries: { },
        out_entries: { },
        in_entries: { }
    };

    var context = {
    };

    //第一步，加载所有out/in账户信息，判断所有out账户是否已经签名
    loadEntry(block, local);

    //第二步，先验证签名
    verifySign(block, local);

    //第三步，判断必须存在 和 不存在的账户
    checkEntryExistence(block, local);

    //第四步，运行脚本api
    installApi(context, block, local);

    //避免闲得蛋疼的人
    context.check = function() { };

    //第五步，保存数据
    context.finish = function() {
        for(var entryId in local.new_entries)
        {
            var entry = local.new_entries[entryId];

            data.write(entry);
        }

        for(var entryId in local.out_entries)
        {
            var entry = local.out_entries[entryId];

            data.write(entry);
        }

        for(var entryId in local.in_entries)
        {
            var entry = local.in_entries[entryId];

            data.write(entry);
        }
    };

    return context;
};

/**
 * 验证一个区块信息是否合法
*/
exports.verify = function(block) {
    try
    {
        var context = verifyContext(block);

        vm.createContext(context);

        var script = new Buffer(block.script, "base64").toString("utf-8");
    
        vm.runInContext(script, context);

        context.check();
    } catch(err)
    {
        console.error(`${err}\n${err.stack}`);
        return err.toString();
    }

    return null;
};

/**
 * 执行一个区块信息中的脚本
*/
exports.run = function(block) {
    try
    {
        var context = runContext(block);

        vm.createContext(context);

        var script = new Buffer(block.script, "base64").toString("utf-8");

        vm.runInContext(script, context);

        context.finish();
    } catch(err)
    {
        console.error(`${err}\n${err.stack}`);
        return err.toString();
    }

    return null;
};

