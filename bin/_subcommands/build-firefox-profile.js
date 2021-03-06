'use strict';
const fs = require('fs-extra');
const {resolve: resolvePath} = require('path');

const {buildFirefoxProfile} = require('../..');
const {checkOptionFileAccess, checkOptionIsDirectory} = require('../../lib/node/cli');

const {R_OK, X_OK, W_OK} = fs.constants;

const buildFirefoxProfileHandler = async argv => {
    const optionValidationResults = await Promise.all([
        checkOptionIsDirectory(argv, 'tmp'),
        checkOptionFileAccess(argv, 'tmp', R_OK | W_OK | X_OK),
    ]);

    if (!Math.min(...optionValidationResults)) {
        return 1;
    }

    const outputPath = resolvePath(argv.output);
    console.log('*** Creating a new profile at', outputPath);

    await buildFirefoxProfile({
        tempDirectory: argv.tmp,
        preloadExtension: true,
        outputPath,
        extensionOptions: {
            cncPort: argv.cncPort,
            instrumentCoverage: argv.coverage,
        },
    });
    console.log('*** Done!');
    return 0;
};

exports.handler = buildFirefoxProfileHandler;
