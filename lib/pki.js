var forge = require('node-forge');
var uuidv4 = require("uuid/v4");

const v4 = new RegExp(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i);

//验证对方节点公钥证书
exports.verifyCert = function(ca, cert, cname) {
    var caCert = forge.pki.certificateFromPem(ca.toString());

    var clientCerts = [ ];

    {//从公钥证书中 加载 公钥链
        var endTag = "-----END CERTIFICATE-----";

        var parts = cert.toString().split(endTag);

        parts.forEach(function(part) {
            part = part.trim();

            if (part == "")
                return true;

            part += endTag;

            var cert = forge.pki.certificateFromPem(part);

            clientCerts.push(cert);

            return true;
        });
    }

    if (!clientCerts[0].subject.getField('CN').value == cname)
    {
        return `mismatch commonName ${clientCerts[0].subject.getField('CN').value} != ${commonName}.`;
    }

    var caStore = forge.pki.createCaStore([ caCert ]);

    try
    {
        if (!forge.pki.verifyCertificateChain(caStore, clientCerts))
        {
            return "failed to verify cert.";
        }
    } catch(err)
    {
        return err;
    }

    return null;
};

//签名
exports.signIt = function(digest, key) {
    var privateKey = forge.pki.privateKeyFromPem(key.toString());

    var pss = forge.pss.create({
        md: forge.md.sha256.create(),
        mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
        saltLength: 20
    });

    return privateKey.sign(digest, pss);
};

//验签
exports.verifyItsSign = function(digest, cert, sign, cname) {
    /** 先验证一下公钥证书 */
    if (exports.verifyCert(config.certs.ca, cert, cname) != null)
        return false;

    var publicKey = forge.pki.certificateFromPem(cert.toString()).publicKey;

    var pss = forge.pss.create({
        md: forge.md.sha256.create(),
        mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
        saltLength: 20
    });

    return publicKey.verify(digest.digest().getBytes(), sign, pss);
};

//数据摘要
exports.digest = function(items, fields) {
    var buffer = fields.map(function(field) {
        return JSON.stringify(items[field]);
    });

    var data = buffer.join("|");

    var digest = forge.md.sha256.create();

    digest.update(data);

    return digest;
};

//数据签名
exports.sign = function(data, key, node) {
    var digest = forge.md.sha256.create();

    digest.update(data);
    digest.update(node.uuid);

    return exports.signIt(digest, key);
};

//数据验签
exports.verifySign = function(data, cert, sign, node) {
    var digest = forge.md.sha256.create();

    digest.update(data);
    digest.update(node.uuid);

    return exports.verifyItsSign(digest, cert, sign, node.uuid);
};

//生成账户及证书
exports.generateEntry = function(entryId, password, email) {
    if (entryId == null || entryId.trim() == "")
    {
        entryId = uuidv4();
    }

    if (!entryId.match(v4))
        throw `${entryId} is not uuid.`;

    password = password || "";
    email = email || "";

    password = password.trim();

    var nodeCert = forge.pki.certificateFromPem(config.certs.cert.toString());
    var nodeKey = forge.pki.privateKeyFromPem(config.certs.key.toString());

    var keys = forge.pki.rsa.generateKeyPair(2048);

    var cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;

    cert.serialNumber = '01';

    cert.validity.notBefore = new Date();

    //一年有效期
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    cert.setSubject([
        {
            shortName: 'CN',
            value: entryId
        },
        {
            shortName: 'C',
            value: 'CN'
        },
        {
            shortName: 'ST',
            value: 'BJ'
        },
        {
            shortName: 'L',
            value: 'BJ'
        },
        {
            shortName: 'O',
            value: 'ODS'
        },
        {
            shortName: 'OU',
            value: 'Devel'
        },
        {
            name: "emailAddress",
            value: email
        }
    ]);

    cert.setIssuer(nodeCert.subject.attributes);
    cert.sign(nodeKey);

    var publicPem = [
        forge.pki.certificateToPem(cert).trim(),
        config.certs.cert.toString().trim()
    ].join("\n");

    /*var encryptedPrivateKeyInfo = forge.pki.encryptPrivateKeyInfo(
        forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)),
        password, {
            algorithm: '3des',
        }
    );

    var privatePem =
        forge.pki.encryptedPrivateKeyToPem(encryptedPrivateKeyInfo);*/

    var privatePem =
        forge.pki.encryptRsaPrivateKey(keys.privateKey, password, {
            algorithm: '3des',
        });

    return {
        entryId: entryId,
        cert: Buffer.from(publicPem).toString("base64"),
        key: Buffer.from(privatePem).toString("base64")
    };
};

//解析带密码的私钥证书
exports.loadPrivateKey = function(key, password) {
    var privateKey = forge.pki.decryptRsaPrivateKey(key.toString(), password);
    if (privateKey == null)
        return privateKey;

    return Buffer.from(forge.pki.privateKeyToPem(privateKey));
};
