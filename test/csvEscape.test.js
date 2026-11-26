'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { escapeCsvValue } = require('../src/export/csvEscape');

describe('escapeCsvValue', () => {
    test('an ordinary value passes through unchanged', () => {
        assert.equal(escapeCsvValue('Johnny Rico'), 'Johnny Rico');
        assert.equal(escapeCsvValue(42), '42');
        assert.equal(escapeCsvValue(null), '');
        assert.equal(escapeCsvValue(undefined), '');
    });

    test('a value containing a comma, quote, or newline is CSV-quoted', () => {
        assert.equal(escapeCsvValue('a,b'), '"a,b"');
        assert.equal(escapeCsvValue('say "hi"'), '"say ""hi"""');
        assert.equal(escapeCsvValue('line1\nline2'), '"line1\nline2"');
    });

    describe('spreadsheet formula injection guard (OWASP CSV injection)', () => {
        test('a value starting with = is prefixed with a guarding apostrophe', () => {
            assert.equal(escapeCsvValue('=1+1'), "'=1+1");
        });

        test('a formula value that also contains a quote gets both the guard and CSV quoting', () => {
            assert.equal(escapeCsvValue('=HYPERLINK("http://evil.example/")'), '"\'=HYPERLINK(""http://evil.example/"")"');
        });

        test('a value starting with +, -, or @ is also guarded', () => {
            assert.equal(escapeCsvValue('+1 555 0100'), "'+1 555 0100");
            assert.equal(escapeCsvValue('-5'), "'-5");
            assert.equal(escapeCsvValue('@mention'), "'@mention");
        });

        test('a value starting with a tab or carriage return is guarded too', () => {
            assert.equal(escapeCsvValue('\t=1+1'), "'\t=1+1");
            assert.equal(escapeCsvValue('\r=1+1'), "'\r=1+1");
        });

        test('a formula-triggering value that also needs CSV quoting gets both protections, guard applied first', () => {
            assert.equal(escapeCsvValue('=A1,"x"'), '"\'=A1,""x"""');
        });

        test('a normal value that merely contains = later in the string is not guarded', () => {
            assert.equal(escapeCsvValue('score=10'), 'score=10');
        });

        test('an empty value is not guarded (nothing to guard)', () => {
            assert.equal(escapeCsvValue(''), '');
        });
    });
});
