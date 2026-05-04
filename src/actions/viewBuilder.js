'use strict';

const core = require('./viewBuilderCore');
const guided = require('./viewBuilderGuided');

module.exports = {
    ...core,
    ...guided
};
