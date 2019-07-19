var fs = require("fs");

var argv = require("attrs.argv");

var db2 = require("berkeleydb");

var q = require("bluebird");


var dbname = argv.db;
var action = argv.action;
var index = argv.index;
var data = argv.data;

if (data != null)
    data = fs.readFileSync(data, "utf-8");

var opts = {
    json: true
};

var local = {
};

var actions = {
    ls: function() {
        var cursor = new db2.DbCursor(local.db);

        var items = { };

        var tuple = cursor.first(opts);

        if (tuple.key != null)
        {
            items[tuple.key] = tuple.value;

            do
            {
                tuple = cursor.next(opts);

                if (tuple.key == null)
                    break;

                items[tuple.key] = tuple.value;
            } while(true);
        }

        cursor.close();

        console.log(JSON.stringify(items, "", "    "));
        console.log(`${Object.keys(items).length} rows`);
    },
    get: function() {
        var value = local.db.get(index, opts);

        console.log(JSON.stringify(value, "", "    "));
    },
    put: function() {
        local.db.put(index, data);

        console.log("ok!");
    },
    del: function() {
        local.db.del(index);

        console.log("ok!");
    },
    clear: function() {
        local.db.truncate();

        console.log("ok!");
    }
};

q.resolve({ })
  .then(function() {
      local.dbenv = new db2.DbEnv();

      local.dbenv.open("data");

      local.db = new db2.Db(local.dbenv);

      local.db.open(dbname);
  })
  .then(function() {
      return actions[action]();
  })
  .done(function() {
      local.db.close();
      local.dbenv.close();
  });  


