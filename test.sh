node ./client.js --action new-entry --output ./test/noah/

#node ./client.js --action build-txn --txn ./test/txns/01_golden/txn
#node ./client.js --action commit-txn --txn ./test/txns/01_golden/txn

#node ./client.js --action build-txn --txn ./test/txns/02_noah/txn
#node ./client.js --action commit-txn --txn ./test/txns/02_noah/txn

#node ./client.js --action build-txn --txn ./test/txns/03_init_balance/txn
#node ./client.js --action sign-txn --txn ./test/txns/03_init_balance/txn --id e695fb06-a9e7-11e9-9666-a78541c3a0d8 --key ./test/golden/e695fb06-a9e7-11e9-9666-a78541c3a0d8.key --password crdloo502
#node ./client.js --action commit-txn --txn ./test/txns/03_init_balance/txn

#node ./client.js --action build-txn --txn ./test/txns/04_transfer/txn
#node ./client.js --action sign-txn --txn ./test/txns/04_transfer/txn --id 6c0d3149-6c24-4a1f-ad30-8c6c7ce821cb --key ./test/noah/6c0d3149-6c24-4a1f-ad30-8c6c7ce821cb.key --password crdloo502
#node ./client.js --action commit-txn --txn ./test/txns/04_transfer/txn
