const nodeGlobals = {
    console: 'readonly',
    process: 'readonly',
    Buffer: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    module: 'readonly',
    exports: 'readonly',
    require: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    setImmediate: 'readonly'
};

const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    location: 'readonly',
    CSS: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    HTMLElement: 'readonly',
    Node: 'readonly',
    Event: 'readonly',
    CustomEvent: 'readonly',
    requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly',
    acquireVsCodeApi: 'readonly',
    ReactFlow: 'readonly',
    ELK: 'readonly'
};

const testGlobals = {
    ...nodeGlobals,
    test: 'readonly',
    describe: 'readonly',
    before: 'readonly',
    beforeEach: 'readonly',
    after: 'readonly',
    afterEach: 'readonly'
};

const baseRules = {
    'no-undef': 'error',
    'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }]
};

module.exports = [
    {
        ignores: [
            'backup/**',
            'docs/**',
            'media/**',
            'sample/**',
            'src/features/vendor/**',
            'node_modules/**'
        ]
    },
    {
        files: ['extension.js', 'src/**/*.js', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: nodeGlobals
        },
        rules: baseRules
    },
    {
        files: [
            'src/features/**/*Script.js',
            'src/features/**/*Runtime.js',
            'src/features/**/*Html.js',
            'src/features/graph2/graph2ClientScript.js'
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                ...nodeGlobals,
                ...browserGlobals
            }
        },
        rules: baseRules
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: testGlobals
        },
        rules: baseRules
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: nodeGlobals
        },
        rules: baseRules
    }
];
