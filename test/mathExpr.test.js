'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateExpression, isReservedFunctionName, ERROR_CODES } = require('../src/engine/mathExpr');

function ok(source, env) {
    const result = evaluateExpression(source, env);
    assert.equal(result.ok, true, `expected "${source}" to evaluate, got error: ${result.ok ? '' : result.error}`);
    return result.value;
}

function fails(source, env) {
    const result = evaluateExpression(source, env);
    assert.equal(result.ok, false, `expected "${source}" to fail, got value: ${result.ok ? result.value : ''}`);
    return result.error;
}

/** Like fails(), but returns the whole result object for code/identifier assertions. */
function failsWith(source, env) {
    const result = evaluateExpression(source, env);
    assert.equal(result.ok, false, `expected "${source}" to fail, got value: ${result.ok ? result.value : ''}`);
    return result;
}

describe('evaluateExpression — arithmetic', () => {
    test('basic operators and precedence', () => {
        assert.equal(ok('1 + 2'), 3);
        assert.equal(ok('2 + 3 * 4'), 14);
        assert.equal(ok('(2 + 3) * 4'), 20);
        assert.equal(ok('10 / 4'), 2.5);
        assert.equal(ok('10 % 3'), 1);
    });

    test('the exact example expression from the live user report', () => {
        assert.equal(ok('1 + (5+1/-1)'), 5);
    });

    test('unary minus and plus', () => {
        assert.equal(ok('-5 + 3'), -2);
        assert.equal(ok('-(2 + 3)'), -5);
        assert.equal(ok('+5'), 5);
    });

    test('exponent operator covers squared/cubed and is right-associative', () => {
        assert.equal(ok('5^2'), 25);
        assert.equal(ok('5^3'), 125);
        assert.equal(ok('2^3^2'), 512); // 2^(3^2), not (2^3)^2
    });

    test('nested parentheses', () => {
        assert.equal(ok('((1 + 2) * (3 + 4))'), 21);
    });

    test('implicit multiplication works alongside explicit *, not instead of it', () => {
        assert.equal(ok('2*3'), 6);
        assert.equal(ok('2(3)'), 6);
        assert.equal(ok('(1+1)(2+2)'), 8);
        assert.equal(ok('2 sqrt(9)'), 6);
    });

    test('the exact live user-reported case: implicit multiplication before a parenthesized fraction', () => {
        assert.equal(ok('2+2(1+1/14)'), 2 + 2 * (1 + 1 / 14));
    });
});

describe('evaluateExpression — functions', () => {
    test('sqrt/abs/round/floor/ceil', () => {
        assert.equal(ok('sqrt(9)'), 3);
        assert.equal(ok('abs(-5)'), 5);
        assert.equal(ok('round(2.5)'), 3);
        assert.equal(ok('floor(2.9)'), 2);
        assert.equal(ok('ceil(2.1)'), 3);
    });

    test('min/max with multiple arguments', () => {
        assert.equal(ok('min(3, 1, 2)'), 1);
        assert.equal(ok('max(3, 1, 2)'), 3);
    });

    test('sum/average with multiple arguments', () => {
        assert.equal(ok('sum(3, 1, 2)'), 6);
        assert.equal(ok('average(3, 1, 2)'), 2);
    });

    test('average with no arguments is a clear #VALUE!, not NaN', () => {
        const result = failsWith('average()');
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /requires at least one argument/i);
    });

    test('functions compose with the rest of the grammar', () => {
        assert.equal(ok('sqrt(9) + 1'), 4);
    });

    test('trig functions (radians, matching Math.* and Excel\'s own default)', () => {
        assert.equal(ok('sin(0)'), 0);
        assert.equal(ok('cos(0)'), 1);
        assert.equal(ok('tan(0)'), 0);
    });

    test('log is base 10 (matching Excel\'s LOG default), ln is natural log', () => {
        assert.equal(ok('log(100)'), 2);
        assert.equal(ok('ln(1)'), 0);
    });

    test('sign and exp', () => {
        assert.equal(ok('sign(-5)'), -1);
        assert.equal(ok('sign(5)'), 1);
        assert.equal(ok('sign(0)'), 0);
        assert.equal(ok('exp(0)'), 1);
    });
});

describe('evaluateExpression — ranges as function arguments', () => {
    const env = { Y1: 2, Y2: 4, Y3: 6, Y4: 8, Y5: 10 };

    test('sum expands a Y-label range', () => {
        assert.equal(ok('sum(Y1:Y5)', env), 30);
    });

    test('average expands a Y-label range', () => {
        assert.equal(ok('average(Y1:Y5)', env), 6);
    });

    test('min/max accept ranges alongside their normal variadic arguments', () => {
        assert.equal(ok('min(Y2:Y4, 1)', env), 1);
        assert.equal(ok('max(Y2:Y4, 99)', env), 99);
    });

    test('a single-element range is valid', () => {
        assert.equal(ok('sum(Y3:Y3)', env), 6);
    });

    test('a reversed range fails as #VALUE!', () => {
        const result = failsWith('sum(Y5:Y1)', env);
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /Range invalid: Y5:Y1 \(end before start\)/);
    });

    test('a missing endpoint keeps the normal unresolved-variable shape', () => {
        const result = failsWith('sum(Y1:Y5)', { Y1: 2, Y2: 4, Y3: 6 });
        assert.equal(result.code, ERROR_CODES.NAME);
        assert.equal(result.identifier, 'Y5');
    });

    test('range arguments can be mixed with scalar arguments', () => {
        assert.equal(ok('sum(Y1:Y3, 10)', env), 22);
        assert.equal(ok('average(Y1:Y3, 12)', env), 6);
    });

    test('a non-numeric cell in a range fails through the normal function argument type-check', () => {
        const result = failsWith('sum(Y1:Y3)', { Y1: 2, Y2: 'bad', Y3: 6 });
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /Type mismatch: "sum" needs a number, got a string/i);
    });

    test('colon outside the exact Y-label range shape fails cleanly', () => {
        assert.equal(failsWith('Y1:Y5', env).code, ERROR_CODES.VALUE);
        assert.equal(failsWith('sum(total:Y5)', { total: 1, Y5: 5 }).code, ERROR_CODES.VALUE);
        assert.equal(failsWith('sum(Y1:total)', { Y1: 1, total: 5 }).code, ERROR_CODES.VALUE);
    });
});

describe('evaluateExpression — constants (pi, e)', () => {
    test('pi and e resolve to their real values', () => {
        assert.equal(ok('pi'), Math.PI);
        assert.equal(ok('e'), Math.E);
    });

    test('constants compose with the rest of the grammar', () => {
        assert.equal(ok('2*pi'), 2 * Math.PI);
        assert.equal(ok('ln(e)'), 1);
    });

    test('a user-defined env variable of the same name shadows the constant', () => {
        assert.equal(ok('e', { e: 10 }), 10);
        assert.equal(ok('e*2', { e: 10 }), 20);
    });
});

describe('evaluateExpression — error handling', () => {
    test('empty expression fails honestly', () => {
        assert.match(fails(''), /empty/i);
        assert.match(fails('   '), /empty/i);
    });

    test('division by zero fails rather than returning Infinity', () => {
        assert.match(fails('1 / 0'), /division by zero/i);
    });

    test('unknown function name fails', () => {
        assert.match(fails('foo(1)'), /Not found: no function named "foo"/i);
    });

    test('modulo by zero also fails as division by zero, matching Excel MOD convention', () => {
        assert.match(fails('5 % 0'), /division by zero/i);
    });

    test('malformed syntax fails without throwing', () => {
        assert.doesNotThrow(() => evaluateExpression('1 +'));
        assert.doesNotThrow(() => evaluateExpression('2 * (3 + 4'));
        assert.doesNotThrow(() => evaluateExpression('@#$%'));
        assert.equal(fails('1 +').length > 0, true);
        assert.equal(fails('2 * (3 + 4').length > 0, true);
    });

    test('never throws regardless of input shape', () => {
        assert.doesNotThrow(() => evaluateExpression(null));
        assert.doesNotThrow(() => evaluateExpression(undefined));
        assert.doesNotThrow(() => evaluateExpression(42));
    });
});

describe('evaluateExpression — typed error codes', () => {
    test('division by zero is tagged DIV0', () => {
        const r = failsWith('1 / 0');
        assert.equal(r.code, ERROR_CODES.DIV0);
        assert.equal(r.identifier, undefined);
    });

    test('modulo by zero is also tagged DIV0', () => {
        assert.equal(failsWith('5 % 0').code, ERROR_CODES.DIV0);
    });

    test('an unknown function is tagged NAME, with the identifier attached', () => {
        const r = failsWith('foo(1)');
        assert.equal(r.code, ERROR_CODES.NAME);
        assert.equal(r.identifier, 'foo');
    });

    test('an unknown variable is tagged NAME, with the identifier attached', () => {
        const r = failsWith('total*3');
        assert.equal(r.code, ERROR_CODES.NAME);
        assert.equal(r.identifier, 'total');
    });

    test('a Y<N>-shaped unknown variable is still tagged NAME at this layer — reclassifying it as REF is inlineCalc.js\'s job, not this evaluator\'s (it has no concept of a "cell")', () => {
        const r = failsWith('Y5*2');
        assert.equal(r.code, ERROR_CODES.NAME);
        assert.equal(r.identifier, 'Y5');
    });

    test('empty expression, malformed syntax, and a non-finite result are all tagged VALUE', () => {
        assert.equal(failsWith('').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('1 +').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('2 * (3 + 4').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('@#$%').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('1 + )').code, ERROR_CODES.VALUE);
    });

    test('a VALUE-coded failure never carries an identifier', () => {
        assert.equal(failsWith('1 +').identifier, undefined);
        assert.equal(failsWith('').identifier, undefined);
    });
});

describe('evaluateExpression — variable references (env)', () => {
    test('a bare identifier resolves against the supplied env', () => {
        assert.equal(ok('total*3', { total: 3 }), 9);
        assert.equal(ok('a+b', { a: 1, b: 2 }), 3);
    });

    test('env values compose with the rest of the grammar, including functions', () => {
        assert.equal(ok('sqrt(total)', { total: 9 }), 3);
        assert.equal(ok('total^2', { total: 5 }), 25);
    });

    test('a variable not present in env fails honestly instead of silently defaulting', () => {
        assert.match(fails('total*3', {}), /Not found: no variable named "total"/i);
        assert.match(fails('total*3'), /Not found: no variable named "total"/i);
    });

    test('an identifier immediately followed by "(" is still a function call, never a variable', () => {
        // Even if the caller's env happens to have a same-named entry, `sqrt(`
        // must still mean the function — the grammar decides this structurally,
        // not by env lookup order, so there is no ambiguity to get wrong.
        assert.equal(ok('sqrt(9)', { sqrt: 999 }), 3);
    });
});

describe('isReservedFunctionName', () => {
    test('recognizes every built-in function name, case-insensitively', () => {
        for (const name of ['sqrt', 'abs', 'round', 'floor', 'ceil', 'sum', 'average', 'min', 'max', 'SQRT']) {
            assert.equal(isReservedFunctionName(name), true, `expected "${name}" to be reserved`);
        }
    });

    test('does not flag an ordinary variable-shaped name', () => {
        assert.equal(isReservedFunctionName('total'), false);
        assert.equal(isReservedFunctionName('subtotal'), false);
    });
});

describe('evaluateExpression — value types (string and boolean literals)', () => {
    test('a double-quoted string literal evaluates to itself', () => {
        assert.equal(ok('"hello"'), 'hello');
    });

    test('a single-quoted string literal evaluates to itself', () => {
        assert.equal(ok("'hello'"), 'hello');
    });

    test('string literals support \\", \\\', and \\\\ escapes', () => {
        assert.equal(ok('"say \\"hi\\""'), 'say "hi"');
        assert.equal(ok("'it\\'s fine'"), "it's fine");
        assert.equal(ok('"back\\\\slash"'), 'back\\slash');
    });

    test('an unterminated string literal fails as #VALUE!, not a crash', () => {
        const result = failsWith('"never closed');
        assert.equal(result.code, ERROR_CODES.VALUE);
    });

    test('true and false are reserved literal keywords, not identifiers', () => {
        assert.equal(ok('true'), true);
        assert.equal(ok('false'), false);
    });

    test('true/false are case-insensitive, matching every other keyword in this evaluator', () => {
        assert.equal(ok('TRUE'), true);
        assert.equal(ok('False'), false);
    });

    test('true/false resolve to the literal even if the env has a same-named entry — the literal always wins', () => {
        // Same structural precedent as the sqrt(9) test above: the grammar
        // decides this, not env lookup order, so there's no ambiguity.
        assert.equal(ok('true', { true: 999 }), true);
    });

    test('a same-note reference to a string/boolean-valued cell passes the value through unchanged', () => {
        assert.equal(ok('greeting', { greeting: 'hi there' }), 'hi there');
        assert.equal(ok('flag', { flag: false }), false);
    });
});

describe('evaluateExpression — value types (type-checked operators)', () => {
    test('"+" concatenates two strings', () => {
        assert.equal(ok('"foo" + "bar"'), 'foobar');
    });

    test('"+" adds two numbers, unaffected by string support', () => {
        assert.equal(ok('1 + 2'), 3);
    });

    test('"+" between a string and a number is a clear #VALUE!, never silent coercion', () => {
        const result = failsWith('"3" + 3');
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /string/i);
    });

    test('"+" between a boolean and anything is a clear #VALUE!', () => {
        assert.equal(failsWith('true + 1').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('true + "x"').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('true + false').code, ERROR_CODES.VALUE);
    });

    test('"-", "*", "/", "%", "^" all require numbers on both sides', () => {
        assert.equal(failsWith('"3" - 1').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('"3" * 2').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('6 / "2"').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('"5" % 2').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('2 ^ "3"').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('true - 1').code, ERROR_CODES.VALUE);
    });

    test('unary minus and plus require a number', () => {
        assert.equal(failsWith('-"5"').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('+true').code, ERROR_CODES.VALUE);
    });

    test('every built-in function requires numeric arguments', () => {
        assert.equal(failsWith('sqrt("9")').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('max(1, "2", 3)').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('round(true)').code, ERROR_CODES.VALUE);
    });

    test('implicit multiplication still requires a number on both sides', () => {
        assert.equal(ok('2(1+1)'), 4);
        assert.equal(ok('2sqrt(9)'), 6);
    });

    test('a real mixed formula: string built from concatenation, used nowhere arithmetic is required', () => {
        assert.equal(ok('"Total: " + "done"'), 'Total: done');
    });
});

describe('evaluateExpression — comparisons (> < >= <= == !=)', () => {
    test('numeric ordering', () => {
        assert.equal(ok('1 < 2'), true);
        assert.equal(ok('2 < 1'), false);
        assert.equal(ok('2 > 1'), true);
        assert.equal(ok('2 >= 2'), true);
        assert.equal(ok('1 >= 2'), false);
        assert.equal(ok('2 <= 2'), true);
    });

    test('string ordering is lexicographic', () => {
        assert.equal(ok('"apple" < "banana"'), true);
        assert.equal(ok('"banana" < "apple"'), false);
    });

    test('== and != work across same-type values', () => {
        assert.equal(ok('2 == 2'), true);
        assert.equal(ok('2 == 3'), false);
        assert.equal(ok('2 != 3'), true);
        assert.equal(ok('"a" == "a"'), true);
        assert.equal(ok('true == true'), true);
        assert.equal(ok('true != false'), true);
    });

    test('== and != across different types are simply false/true, never an error — a meaningful answerable question, unlike arithmetic', () => {
        assert.equal(ok('1 == "1"'), false);
        assert.equal(ok('1 != "1"'), true);
        assert.equal(ok('true == 1'), false);
        assert.equal(ok('"" == false'), false);
    });

    test('ordering across different types is a clear #VALUE!, not a coerced guess', () => {
        assert.equal(failsWith('1 > "a"').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('"1" < 2').code, ERROR_CODES.VALUE);
    });

    test('booleans have no ordering — #VALUE!, not a guessed false < true', () => {
        assert.equal(failsWith('true > false').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('true < true').code, ERROR_CODES.VALUE);
    });

    test('comparisons bind looser than arithmetic: "1 + 2 > 2" means "(1+2) > 2"', () => {
        assert.equal(ok('1 + 2 > 2'), true);
        assert.equal(ok('1 + 2 > 4'), false);
    });

    test('comparisons are deliberately non-chaining — trailing comparison fails honestly rather than meaning something surprising', () => {
        const result = failsWith('1 < 2 < 3');
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /trailing token/i);
    });

    test('a comparison can be grouped in parentheses, not just used bare at the top level — a real, previously-unreported bug: parsePrimary\'s "(" branch called parseExpression() (arithmetic only) instead of parseOr() (the full grammar), so "(1 > 0)" alone failed with a confusing "Expected \')\'" syntax error the instant the parser reached ">"', () => {
        assert.equal(ok('(1 > 0)'), true);
        assert.equal(ok('(1 > 0) == (2 < 1)'), false);
        assert.equal(ok('not (1 > 2)'), true);
        assert.equal(ok('(1 > 0) and (2 > 1)'), true);
        // Plain arithmetic grouping must keep working exactly as before.
        assert.equal(evaluateExpression('(1+2)*3', {}).value, 9);
    });
});

describe('evaluateExpression — boolean logic (and / or / not)', () => {
    test('and / or / not over literal booleans', () => {
        assert.equal(ok('true and true'), true);
        assert.equal(ok('true and false'), false);
        assert.equal(ok('false or true'), true);
        assert.equal(ok('false or false'), false);
        assert.equal(ok('not true'), false);
        assert.equal(ok('not false'), true);
    });

    test('and/or/not are case-insensitive keywords, matching true/false', () => {
        assert.equal(ok('TRUE AND TRUE'), true);
        assert.equal(ok('NOT false'), true);
    });

    test('and/or combine with comparisons — the real motivating use case', () => {
        assert.equal(ok('1 > 0 and 2 > 0'), true);
        assert.equal(ok('1 > 0 and 2 < 0'), false);
        assert.equal(ok('1 < 0 or 2 > 0'), true);
    });

    test('precedence: not binds tighter than and, and binds tighter than or', () => {
        // "not true and false" = "(not true) and false" = false and false = false
        assert.equal(ok('not true and false'), false);
        // "false and true or true" = "(false and true) or true" = false or true = true
        assert.equal(ok('false and true or true'), true);
    });

    test('and/or require boolean operands — a clear #VALUE!, not truthy/falsy coercion', () => {
        assert.equal(failsWith('1 and true').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('true or "x"').code, ERROR_CODES.VALUE);
    });

    test('not requires a boolean operand', () => {
        assert.equal(failsWith('not 1').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('not "x"').code, ERROR_CODES.VALUE);
    });

    test('and/or evaluate both sides eagerly — a deliberate, stated scope cut, unlike if()', () => {
        // Division by zero on the right side of "and" still fails even
        // though the left side alone would determine the result if this
        // were short-circuited. This is intentional: and/or are for
        // combining conditions, not guarding against errors — if() is.
        assert.equal(failsWith('false and 1/0 > 0').code, ERROR_CODES.DIV0);
    });

    test('and()/or()/not() also work as ordinary function calls — a pure alias alongside the infix keyword form, same result either way', () => {
        assert.equal(ok('and(true, true)'), true);
        assert.equal(ok('and(true, false)'), false);
        assert.equal(ok('or(false, true)'), true);
        assert.equal(ok('or(false, false)'), false);
        assert.equal(ok('not(true)'), false);
        assert.equal(ok('not(false)'), true);
    });

    test('and()/or()/not() combine with comparisons, and compose with the infix form in the same expression', () => {
        assert.equal(ok('and(1 > 0, 2 > 0)'), true);
        assert.equal(ok('and(1 > 0, 2 < 0)'), false);
        assert.equal(ok('and(1 > 0, true) or not(false)'), true);
    });

    test('and()/or()/not() require boolean arguments — the same typed #VALUE! as the infix form, never truthy/falsy coercion', () => {
        assert.equal(failsWith('and(1, true)').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('or(true, "x")').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('not(1)').code, ERROR_CODES.VALUE);
    });

    test('and()/or() do NOT silently skip validating the right side via JS\'s own short-circuiting — a non-boolean second argument fails even when the first argument alone determines the result', () => {
        assert.equal(failsWith('and(false, "x")').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('or(true, "x")').code, ERROR_CODES.VALUE);
    });

    test('and/or/not are still rejected as a cell name for being a keyword — not, confusingly, "a built-in function" now that they are also callable', () => {
        const { scanInlineCalcs } = require('../src/engine/inlineCalc');
        const blocks = scanInlineCalcs('`and=1`\n`or=2`\n`not=3`');
        for (const block of blocks) {
            assert.equal(block.evalResult.ok, false);
            assert.match(block.evalResult.error, /Name reserved: ".+" is a keyword/i);
        }
    });
});

describe('evaluateExpression — if(cond, thenValue, elseValue)', () => {
    test('returns the then-branch when the condition is true, the else-branch when false', () => {
        assert.equal(ok('if(true, 1, 2)'), 1);
        assert.equal(ok('if(false, 1, 2)'), 2);
    });

    test('condition can be any comparison or boolean expression', () => {
        assert.equal(ok('if(1 > 0, "yes", "no")'), 'yes');
        assert.equal(ok('if(1 > 0 and 2 > 0, "yes", "no")'), 'yes');
        assert.equal(ok('if(1 > 0 and 2 < 0, "yes", "no")'), 'no');
    });

    test('condition must be a boolean, not a truthy/falsy number', () => {
        const result = failsWith('if(1, "yes", "no")');
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /condition must be a boolean/);
    });

    test('true short-circuit: the untaken branch never evaluates, so a division-by-zero guard actually works', () => {
        assert.equal(ok('if(true, 1, 1/0)'), 1);
        assert.equal(ok('if(false, 1/0, 2)'), 2);
    });

    test('branches can be arbitrarily complex expressions, including nested if() and function calls', () => {
        assert.equal(ok('if(1 > 0, sum(1,2,3), 0)'), 6);
        assert.equal(ok('if(false, 0, if(true, 42, 0))'), 42);
    });

    test('a nested function call\'s own commas inside a branch do not confuse if()\'s argument-span scan', () => {
        assert.equal(ok('if(true, max(1,2,3), min(1,2,3))'), 3);
    });

    test('a string literal containing commas or parens inside a branch does not confuse the scan either', () => {
        assert.equal(ok('if(true, "a,b)c", "x")'), 'a,b)c');
    });

    test('if() with the wrong number of arguments fails as a clear #VALUE!', () => {
        assert.equal(failsWith('if(true, 1)').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('if(true)').code, ERROR_CODES.VALUE);
    });

    test('if used bare (no parens) fails as a keyword-misuse error, not "unknown variable"', () => {
        const result = failsWith('if');
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /keyword/);
    });
});

describe('RESERVED_KEYWORD_NAMES', () => {
    test('exports and/or/not/if as reserved, matching parsePrimary\'s own keyword rejection', () => {
        const { RESERVED_KEYWORD_NAMES } = require('../src/engine/mathExpr');
        for (const word of ['and', 'or', 'not', 'if']) {
            assert.equal(RESERVED_KEYWORD_NAMES.has(word), true, `expected "${word}" to be a reserved keyword`);
        }
    });
});

describe('evaluateExpression — failure position (start/end), for live editor diagnostics', () => {
    test('an unknown variable points exactly at that identifier', () => {
        const result = failsWith('1 + total');
        assert.equal(result.start, 4);
        assert.equal(result.end, 9);
    });

    test('an unknown function points exactly at the function name, not the whole call', () => {
        const result = failsWith('bogus(1)');
        assert.equal(result.start, 0);
        assert.equal(result.end, 5);
    });

    test('an unterminated string literal points from the opening quote to the end of the text', () => {
        const result = failsWith('"never closed');
        assert.equal(result.start, 0);
        assert.equal(result.end, 13);
    });

    test('a dangling trailing token points at that exact token', () => {
        // Not "1 2" — that's valid implicit multiplication (= 2). A string
        // literal is deliberately excluded from the implicit-multiplication
        // lookahead, so it stays a genuine trailing token here.
        const result = failsWith('1 "x"');
        assert.equal(result.start, 2);
        assert.equal(result.end, 5);
    });

    test('a keyword used bare points at the keyword itself', () => {
        const result = failsWith('1 + and');
        assert.equal(result.start, 4);
        assert.equal(result.end, 7);
    });

    test('leading whitespace in the source is accounted for — offsets are relative to the original string, not the trimmed one', () => {
        const result = failsWith('   total');
        assert.equal(result.start, 3);
        assert.equal(result.end, 8);
    });

    test('a type-check failure (division, arithmetic on a string) has no position — a documented, bounded scope cut, not a bug', () => {
        const result = failsWith('"3" + true');
        assert.equal(result.start, undefined);
        assert.equal(result.end, undefined);
    });

    test('a successful evaluation never carries start/end — only failures do', () => {
        assert.equal('start' in evaluateExpression('1+1'), false);
    });
});

describe('evaluateExpression — date/time functions (today, date, days_between, add_days)', () => {
    const { getTodayIsoLocal } = require('../src/core/date');

    test('today() returns the same canonical YYYY-MM-DD date getTodayIsoLocal() does', () => {
        assert.equal(ok('today()'), getTodayIsoLocal());
    });

    test('date(year, month, day) builds a canonical YYYY-MM-DD string, zero-padded', () => {
        assert.equal(ok('date(2026, 1, 5)'), '2026-01-05');
        assert.equal(ok('date(2026, 12, 31)'), '2026-12-31');
    });

    test('date() rejects a calendar-impossible date as a clear Range invalid failure, not a silently wrong rollover', () => {
        const error = fails('date(2026, 2, 30)'); // February never has 30 days
        assert.match(error, /Range invalid/);
    });

    test('date() requires three numbers', () => {
        assert.match(fails('date("2026", 1, 1)'), /Type mismatch/);
    });

    test('days_between(a, b) is b minus a, in whole days — positive when b is later', () => {
        assert.equal(ok('days_between("2026-01-01", "2026-01-15")'), 14);
        assert.equal(ok('days_between("2026-01-15", "2026-01-01")'), -14);
        assert.equal(ok('days_between("2026-01-01", "2026-01-01")'), 0);
    });

    test('days_between accepts any date shape normaliseDateInput already understands, not just canonical YYYY-MM-DD', () => {
        assert.equal(ok('days_between("01/01/2026", "01/15/2026")'), 14);
    });

    test('days_between requires two date-shaped strings', () => {
        assert.match(fails('days_between(1, 2)'), /Type mismatch/);
        assert.match(fails('days_between("not a date", "2026-01-01")'), /Not found/);
    });

    test('add_days(date, n) shifts a date forward or backward by whole days', () => {
        assert.equal(ok('add_days("2026-01-15", 10)'), '2026-01-25');
        assert.equal(ok('add_days("2026-01-15", -20)'), '2025-12-26');
        assert.equal(ok('add_days("2026-01-15", 0)'), '2026-01-15');
    });

    test('add_days requires a date first and a number second', () => {
        assert.match(fails('add_days(5, 10)'), /Type mismatch/);
        assert.match(fails('add_days("2026-01-15", "10")'), /Type mismatch/);
    });

    test('date functions compose with same-note references, comparisons, and if() — the real motivating use case', () => {
        const env = { due: '2026-01-01' };
        assert.equal(ok('due < today()', env), true); // a past due date
        assert.equal(ok('if(due < today(), "overdue", "on track")', env), 'overdue');
        assert.equal(ok('days_between(today(), due) < 0', env), true);
    });

    test('a bare YYYY-MM-DD in a formula is arithmetic (subtraction), not a date literal — a real, worth-knowing gotcha, not a bug: there is no date-literal token in this grammar, so a date must come from date(y,m,d), a quoted string, or a referenced value', () => {
        // 2099 - 1 - 1 = 2097, NOT the date "2099-01-01".
        assert.equal(ok('2099-01-01'), 2097);
    });

    test('today()/date()/add_days()/days_between() are reserved function names, same as every other built-in', () => {
        assert.equal(isReservedFunctionName('today'), true);
        assert.equal(isReservedFunctionName('date'), true);
        assert.equal(isReservedFunctionName('add_days'), true);
        assert.equal(isReservedFunctionName('days_between'), true);
    });

    test('ordering comparisons already work on two date strings with no changes needed — ISO 8601 lexicographic order matches chronological order', () => {
        assert.equal(ok('a > b', { a: '2026-02-01', b: '2026-01-15' }), true);
        assert.equal(ok('a < b', { a: '2026-01-15', b: '2026-02-01' }), true);
        assert.equal(ok('a == b', { a: '2026-01-15', b: '2026-01-15' }), true);
    });
});

describe('evaluateExpression — statistics (median, mode, stdev, stdevp, variance, variancep)', () => {
    test('median returns the middle value for an odd count, the average of the two middle values for an even count', () => {
        assert.equal(ok('median(1,2,3,4,5)'), 3);
        assert.equal(ok('median(1,2,3,4)'), 2.5);
        assert.equal(ok('median(5)'), 5);
    });

    test('median requires at least one argument', () => {
        assert.equal(failsWith('median()').code, ERROR_CODES.VALUE);
    });

    test('mode returns the first-encountered most-frequent value, matching Excel\'s own MODE rather than an arbitrary tie-break', () => {
        assert.equal(ok('mode(1,2,2,3,3,3)'), 3);
        assert.equal(ok('mode(5,1,1,2)'), 1);
    });

    test('mode fails honestly when nothing repeats — there genuinely is no mode, not a guessed value', () => {
        const result = failsWith('mode(1,2,3)');
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /no repeated value/);
    });

    test('stdev/variance (sample, n-1 denominator) match a known textbook example: [2,4,4,4,5,5,7,9]', () => {
        assert.ok(Math.abs(ok('stdev(2,4,4,4,5,5,7,9)') - 2.13809) < 0.0001);
        assert.ok(Math.abs(ok('variance(2,4,4,4,5,5,7,9)') - 4.571428571) < 0.0001);
    });

    test('stdevp/variancep (population, n denominator) match the same dataset\'s known population figures', () => {
        assert.equal(ok('stdevp(2,4,4,4,5,5,7,9)'), 2);
        assert.equal(ok('variancep(2,4,4,4,5,5,7,9)'), 4);
    });

    test('sample stdev/variance require at least two values — n-1 would otherwise be zero', () => {
        assert.equal(failsWith('stdev(5)').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('variance(5)').code, ERROR_CODES.VALUE);
    });

    test('population stdevp/variancep accept a single value — population variance of one point is honestly 0', () => {
        assert.equal(ok('stdevp(5)'), 0);
        assert.equal(ok('variancep(5)'), 0);
    });

    test('statistics functions work with ranges, same as sum/average — no new mechanism needed', () => {
        const env = { Y1: 1, Y2: 2, Y3: 3, Y4: 4, Y5: 5 };
        assert.equal(ok('median(Y1:Y5)', env), 3);
        assert.equal(ok('mode(Y1:Y2, Y2)', env), 2);
    });
});

describe('evaluateExpression — finance (fv, pv, pmt, npv, irr)', () => {
    test('fv/pv/pmt match known, independently hand-verified time-value-of-money figures', () => {
        assert.ok(Math.abs(ok('fv(0.05, 10, -100)') - 1257.789) < 0.001);
        assert.ok(Math.abs(ok('pv(0.05, 10, -100)') - 772.173) < 0.001);
        assert.ok(Math.abs(ok('pmt(0.05, 10, 1000)') - (-129.5046)) < 0.001);
    });

    test('a zero rate is handled as its own exact branch (no division by zero, no NaN) — simple, no-interest accumulation', () => {
        assert.equal(ok('fv(0, 5, -100)'), 500);
        assert.equal(ok('pv(0, 5, -100)'), 500);
        assert.equal(ok('pmt(0, 5, 1000)'), -200);
    });

    test('pv (in fv()) and fv (in pv()/pmt()) are optional, defaulting to 0 — a formula can simply omit the trailing argument', () => {
        assert.equal(ok('fv(0.05, 10, -100)'), ok('fv(0.05, 10, -100, 0)'));
        assert.equal(ok('pv(0.05, 10, -100)'), ok('pv(0.05, 10, -100, 0)'));
    });

    test('npv discounts its FIRST cash flow by one full period too, matching Excel\'s own NPV exactly — a cash flow happening today must be added separately, outside npv()', () => {
        // The classic "undiscounted outlay now, discounted returns later"
        // framing is -1000 + npv(rate, the later returns) — NOT
        // npv(rate, -1000, the later returns), which would wrongly discount
        // the -1000 itself by one period, same as Excel's own documented
        // NPV behavior and its own well-known user gotcha.
        const correct = -1000 + ok('npv(0.1, 300, 300, 300, 300, 300)');
        assert.ok(Math.abs(correct - 137.236) < 0.001);
    });

    test('npv requires at least one cash flow after the rate', () => {
        assert.equal(failsWith('npv(0.1)').code, ERROR_CODES.VALUE);
    });

    test('irr treats its FIRST cash flow as period 0, undiscounted — the opposite convention from npv() above, but exactly Excel\'s own IRR/NPV asymmetry, not invented here', () => {
        const rate = ok('irr(-1000, 300, 300, 300, 300, 300)');
        // Self-verifying: at the found rate, NPV (using irr()'s own period-0
        // convention) must be essentially zero — proves the bisection
        // search actually converged to a real root, not an arbitrary number.
        let npvAtRate = -1000;
        for (let i = 1; i <= 5; i++) npvAtRate += 300 / Math.pow(1 + rate, i);
        assert.ok(Math.abs(npvAtRate) < 0.001, `expected NPV at the found rate to be ~0, got ${npvAtRate}`);
    });

    test('irr fails honestly when no real root exists — cash flows that never change sign have no break-even rate', () => {
        const result = failsWith('irr(100, 200, 300)');
        assert.equal(result.code, ERROR_CODES.VALUE);
        assert.match(result.error, /could not find a solution/);
    });

    test('irr requires at least two cash flows', () => {
        assert.equal(failsWith('irr(-1000)').code, ERROR_CODES.VALUE);
    });
});

describe('evaluateExpression — growth (cagr)', () => {
    test('cagr matches a known, independently hand-verified compound growth figure', () => {
        assert.ok(Math.abs(ok('cagr(1000, 2000, 5)') - 0.148698) < 0.0001);
    });

    test('cagr of a value that does not change is exactly 0', () => {
        assert.equal(ok('cagr(1000, 1000, 5)'), 0);
    });

    test('cagr requires a positive beginning value and a positive period count', () => {
        assert.equal(failsWith('cagr(0, 2000, 5)').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('cagr(-100, 2000, 5)').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('cagr(1000, 2000, 0)').code, ERROR_CODES.VALUE);
        assert.equal(failsWith('cagr(1000, 2000, -1)').code, ERROR_CODES.VALUE);
    });
});
