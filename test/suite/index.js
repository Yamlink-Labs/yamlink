'use strict';

const path = require('path');
const Mocha = require('mocha');

async function run() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 120000
    });

    mocha.addFile(path.resolve(__dirname, 'extension.test.js'));

    return new Promise((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) {
                reject(new Error(`${failures} extension-host test(s) failed.`));
                return;
            }
            resolve();
        });
    });
}

module.exports = {
    run
};
