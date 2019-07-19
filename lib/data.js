var fs = require("fs");

var db2 = require("berkeleydb");

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

    local.dataDb = new db2.Db(global.__dbenv);

    local.dataDb.open("data.db");
};

exports.entry = function(uuid) {
    var data = local.dataDb.get(uuid, opts);

    return data;
};

exports.write = function(entry) {
    local.dataDb.put(entry.id, entry, opts);

    return entry;
};

exports.entires = function() {
    var items = [ ];

    var cursor = new db2.DbCursor(local.dataDb);

    var tuple = cursor.first(opts);

    if (tuple.key != null)
    {
        blocks.push(tuple.value);

        do
        {
            tuple = cursor.next(opts);

            if (tuple.key == null)
                break;

            items.push(tuple.value);
        } while(true);
    }

    cursor.close();

    return items;
};
