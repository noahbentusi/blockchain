var fs = require("fs");
var argv = require("attrs.argv");

var comment_regex = /(\/\*){1}.*(\*\/){1}/g;
 
exports.init = function(configName) {
    configName = argv.config || configName || "./config/node.json";

    var config =
        fs.readFileSync(configName, "utf-8").replace(comment_regex, "");

    global.config = Object.assign({
        "endpoint": {
            "address": "0.0.0.0",
            "port": 10443
        },
        "unl": [ ],
        "opts": {
            "healthyTimer": 300,
            "timeout": 3000,
            "roundTimer": 300,
        }
    }, JSON.parse(config), argv);

    global.config.certs = { };

    if (global.config.endpoint.key != null)
    {
        global.config.certs.key = fs.readFileSync(global.config.endpoint.key);
    }

    if (global.config.endpoint.cert != null)
    {
        global.config.certs.cert = fs.readFileSync(global.config.endpoint.cert);
    }

    if (global.config.endpoint.ca != null)
    {
        global.config.certs.ca = fs.readFileSync(global.config.endpoint.ca);
    }

    if (global.config.endpoint.golden_ca != null)
    {
        global.config.certs.golden_ca =
            fs.readFileSync(global.config.endpoint.golden_ca);
    }

    global.config.node.status = "healthy";

    return global.config;
};
