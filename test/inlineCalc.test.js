'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { scanInlineCalcs, ERROR_CODE_LABELS, formatCalcValue, buildFrontmatterSeedEnv } = require('../src/engine/inlineCalc');

describe('scanInlineCalcs — cell labels', () => {
    test('every block, named or not, gets a Y<N> label in document order', () => {
        const blocks = scanInlineCalcs('`=1+1`\n`total=2+2`\n`=3+3`');
        assert.deepEqual(blocks.map((b) => b.label), ['Y1', 'Y2', 'Y3']);
        assert.deepEqual(blocks.map((b) => b.name), [null, 'total', null]);
    });

    test('a label resolves as a reference to that block\'s value', () => {
        const blocks = scanInlineCalcs('`=1+2`\n`=Y1*3`');
        assert.equal(blocks[1].evalResult.value, 9);
    });

    test('a user-chosen name in the automatic-label shape is rejected, not silently colliding', () => {
        const blocks = scanInlineCalcs('`Y1=5`\n`=Y1`');
        assert.equal(blocks[0].evalResult.ok, false);
        assert.match(blocks[0].evalResult.error, /Name reserved: "Y1" is an automatic cell label/i);
    });

    test('lowercase y1 is an ordinary name — common in math notes, and never collides with Y1', () => {
        const blocks = scanInlineCalcs('`y1=5`\n`=y1*2`');
        assert.equal(blocks[0].evalResult.value, 5);
        assert.equal(blocks[1].evalResult.value, 10);
    });
});

describe('scanInlineCalcs — dependencies', () => {
    test('reports each cell an expression reads, with the value it held, once', () => {
        const blocks = scanInlineCalcs('`total=1+2`\n`=total*total+Y1`');
        assert.deepEqual(blocks[1].deps, [{ ref: 'total', value: 3 }, { ref: 'Y1', value: 3 }]);
    });

    test('function names are never reported as dependencies', () => {
        const blocks = scanInlineCalcs('`n=9`\n`=sqrt(n)`');
        assert.deepEqual(blocks[1].deps, [{ ref: 'n', value: 9 }]);
    });

    test('a block with no references has no dependencies', () => {
        assert.deepEqual(scanInlineCalcs('`=1+1`')[0].deps, []);
    });
});

describe('scanInlineCalcs — offsets', () => {
    test('start/end cover the whole code span and exprStart points at the expression', () => {
        const text = 'a `total=1+2` b';
        const [block] = scanInlineCalcs(text);
        assert.equal(text.slice(block.start, block.end), '`total=1+2`');
        assert.equal(text.slice(block.exprStart, block.exprStart + block.expr.length), '1+2');
    });

    test('exprStart is right for an anonymous block too', () => {
        const text = 'x `=5^2` y';
        const [block] = scanInlineCalcs(text);
        assert.equal(text.slice(block.exprStart, block.exprStart + block.expr.length), '5^2');
    });
});

describe('scanInlineCalcs — opt-in only', () => {
    test('ordinary code spans and fenced blocks are never touched', () => {
        const text = 'Run `npm install`.\n```\n`=1+1`\n```\n';
        assert.equal(scanInlineCalcs(text).length, 0);
    });
});

describe('scanInlineCalcs — value types (string and boolean cells)', () => {
    test('a string-valued cell evaluates and flows into a same-note reference unchanged', () => {
        const blocks = scanInlineCalcs('`greeting="hello"`\n`=greeting + " world"`');
        assert.equal(blocks[0].evalResult.value, 'hello');
        assert.equal(blocks[1].evalResult.value, 'hello world');
    });

    test('a boolean-valued cell evaluates and flows into a same-note reference unchanged', () => {
        const blocks = scanInlineCalcs('`flag=true`\n`other=flag`');
        assert.equal(blocks[0].evalResult.value, true);
        assert.equal(blocks[1].evalResult.value, true);
    });

    test('a cell literally named "true" or "false" is rejected as a reserved literal, not silently shadowing it', () => {
        const blocks = scanInlineCalcs('`true=5`\n`False=6`');
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal(blocks[0].evalResult.code, 'VALUE');
        assert.match(blocks[0].evalResult.error, /Name reserved: "true" is a reserved word/i);
        assert.equal(blocks[1].evalResult.ok, false);
        assert.match(blocks[1].evalResult.error, /Name reserved: "False" is a reserved word/i);
    });

    test('a same-note arithmetic reference to a string/boolean cell fails as a clear #VALUE!, not NaN', () => {
        const blocks = scanInlineCalcs('`label="x"`\n`=label * 2`');
        assert.equal(blocks[1].evalResult.ok, false);
        assert.equal(blocks[1].evalResult.code, 'VALUE');
    });
});

describe('scanInlineCalcs — number formatting (`as <format>` clause)', () => {
    test('a format clause is stripped before evaluation and the underlying value stays a real number', () => {
        const blocks = scanInlineCalcs('`=19.999 as currency`');
        assert.equal(blocks[0].evalResult.ok, true);
        assert.equal(blocks[0].evalResult.value, 19.999);
        assert.equal(blocks[0].expr.trim(), '19.999');
        assert.equal(blocks[0].format, 'currency');
    });

    test('a formatted cell still composes correctly in further same-note math — formatting never leaks into the value', () => {
        const blocks = scanInlineCalcs('`price=10 as currency`\n`=price*3`');
        assert.equal(blocks[1].evalResult.value, 30);
    });

    test('percent and comma formats are recognized, alongside currency', () => {
        const blocks = scanInlineCalcs('`=0.5 as percent`\n`=1234 as comma`');
        assert.equal(blocks[0].format, 'percent');
        assert.equal(blocks[1].format, 'comma');
    });

    test('a decimal-places pattern (0, 0.0, 0.00, ...) is a valid format', () => {
        const blocks = scanInlineCalcs('`=1 as 0`\n`=1 as 0.0`\n`=1 as 0.00`');
        assert.equal(blocks[0].format, '0');
        assert.equal(blocks[1].format, '0.0');
        assert.equal(blocks[2].format, '0.00');
        for (const block of blocks) assert.equal(block.evalResult.ok, true);
    });

    test('an unrecognized format name is a clear #VALUE!, not silently ignored', () => {
        const blocks = scanInlineCalcs('`=1 as bogus`');
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal(blocks[0].evalResult.code, 'VALUE');
        assert.match(blocks[0].evalResult.error, /Format invalid: "bogus"/);
    });

    test('a cell literally named "as" is rejected as reserved, not ambiguous with the format clause', () => {
        const blocks = scanInlineCalcs('`as=5`');
        assert.equal(blocks[0].evalResult.ok, false);
        assert.match(blocks[0].evalResult.error, /Name reserved: "as" is the formatting clause/);
    });

    test('a format clause on a non-numeric (string/boolean) cell is silently ignored at render time, not an error', () => {
        const blocks = scanInlineCalcs('`="hi" as currency`');
        assert.equal(blocks[0].evalResult.ok, true);
        assert.equal(blocks[0].evalResult.value, 'hi');
        assert.equal(formatCalcValue(blocks[0].evalResult.value, blocks[0].format), 'hi');
    });

    test('no format clause leaves format null and display unchanged', () => {
        const blocks = scanInlineCalcs('`=1+1`');
        assert.equal(blocks[0].format, null);
        assert.equal(formatCalcValue(2, null), '2');
    });
});

describe('scanInlineCalcs — frontmatter-valued cells (reading the note\'s own frontmatter)', () => {
    test('a formula can reference a plain frontmatter field by name', () => {
        const blocks = scanInlineCalcs('`total=price*quantity`', { frontmatterFields: { price: 10, quantity: 3 } });
        assert.equal(blocks[0].evalResult.ok, true);
        assert.equal(blocks[0].evalResult.value, 30);
    });

    test('string and boolean frontmatter fields flow through unchanged, same as calc cells', () => {
        const blocks = scanInlineCalcs('`=status + "!"`', { frontmatterFields: { status: 'done' } });
        assert.equal(blocks[0].evalResult.value, 'done!');
    });

    test('a same-note calc cell shadows a frontmatter field of the same name, from the point it\'s defined — same last-write-wins rule as any other redefinition', () => {
        const blocks = scanInlineCalcs('`=price`\n`price=price+5`\n`=price`', { frontmatterFields: { price: 10 } });
        assert.equal(blocks[0].evalResult.value, 10); // before redefinition: frontmatter value
        assert.equal(blocks[1].evalResult.value, 15); // the redefinition itself still reads the old value once
        assert.equal(blocks[2].evalResult.value, 15); // after redefinition: the calc cell's value
    });

    test('a list frontmatter field is simply absent — referencing it fails as an ordinary unknown variable, not a crash', () => {
        const blocks = scanInlineCalcs('`=tags`', { frontmatterFields: { tags: ['a', 'b'] } });
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal(blocks[0].evalResult.code, 'NAME');
    });

    test('a relation (wikilink) frontmatter field is simply absent, not resolved to its raw bracket text', () => {
        const blocks = scanInlineCalcs('`=related`', { frontmatterFields: { related: '[[other-note]]' } });
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal(blocks[0].evalResult.code, 'NAME');
        assert.match(blocks[0].evalResult.error, /no variable named "related"/);
    });

    test('null/undefined frontmatter field values are excluded, not coerced', () => {
        const blocks = scanInlineCalcs('`=maybe`', { frontmatterFields: { maybe: null } });
        assert.equal(blocks[0].evalResult.ok, false);
    });

    test('a hyphenated frontmatter field name is not seeded — it would mis-tokenize as subtraction, so it\'s silently unavailable rather than silently wrong', () => {
        const blocks = scanInlineCalcs('`=unit_price`', { frontmatterFields: { 'unit-price': 5 } });
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal(blocks[0].evalResult.code, 'NAME');
    });

    test('a frontmatter field named "true" is not seeded — the literal keyword always wins, same as for a same-note cell', () => {
        const blocks = scanInlineCalcs('`=true`', { frontmatterFields: { true: 999 } });
        assert.equal(blocks[0].evalResult.value, true); // literal "true", never the frontmatter field
    });

    test('a frontmatter field named "Y1" is never actually reachable — the automatic label Y1 always wins once the first cell exists', () => {
        const blocks = scanInlineCalcs('`=1+1`\n`=Y1`', { frontmatterFields: { Y1: 999 } });
        assert.equal(blocks[1].evalResult.value, 2); // the real first cell's value, never the frontmatter field
    });

    test('no frontmatterFields option behaves exactly as before — every existing caller is unaffected', () => {
        const blocks = scanInlineCalcs('`=1+1`');
        assert.equal(blocks[0].evalResult.value, 2);
    });

    test('buildFrontmatterSeedEnv filters out non-scalar, invalid-identifier, and reserved-name fields directly', () => {
        const seed = buildFrontmatterSeedEnv({
            price: 10,
            label: 'x',
            active: true,
            tags: ['a'],
            related: null,
            'unit-price': 5,
            true: 1,
            Y1: 1
        });
        assert.deepEqual(seed, { price: 10, label: 'x', active: true });
    });

    test('buildFrontmatterSeedEnv tolerates null/undefined/non-object input', () => {
        assert.deepEqual(buildFrontmatterSeedEnv(null), {});
        assert.deepEqual(buildFrontmatterSeedEnv(undefined), {});
        assert.deepEqual(buildFrontmatterSeedEnv('not an object'), {});
    });
});

describe('formatCalcValue', () => {
    test('currency formats to two decimals with a leading $ and thousands separators', () => {
        assert.equal(formatCalcValue(1234.5, 'currency'), '$1,234.50');
        assert.equal(formatCalcValue(19.999, 'currency'), '$20.00');
    });

    test('percent multiplies by 100 and appends %, matching Excel\'s convention', () => {
        assert.equal(formatCalcValue(0.5, 'percent'), '50%');
        assert.equal(formatCalcValue(0.1234, 'percent'), '12.34%');
    });

    test('comma rounds to the nearest integer and adds thousands separators', () => {
        assert.equal(formatCalcValue(1234.6, 'comma'), '1,235');
    });

    test('a decimal pattern fixes the exact number of decimal places', () => {
        assert.equal(formatCalcValue(1.005, '0'), '1');
        assert.equal(formatCalcValue(1.2, '0.00'), '1.20');
    });

    test('a non-numeric value always stringifies plainly, regardless of format', () => {
        assert.equal(formatCalcValue('hello', 'currency'), 'hello');
        assert.equal(formatCalcValue(true, '0.00'), 'true');
    });
});

describe('scanInlineCalcs — comparisons, booleans, and if() (same-note)', () => {
    test('a comparison against an earlier numeric cell produces a boolean cell', () => {
        const blocks = scanInlineCalcs('`budget=100`\n`spent=150`\n`over_budget=spent>budget`');
        assert.equal(blocks[2].evalResult.value, true);
    });

    test('and/or/not compose with earlier boolean cells', () => {
        const blocks = scanInlineCalcs('`a=true`\n`b=false`\n`combined=a and not b`');
        assert.equal(blocks[2].evalResult.value, true);
    });

    test('if() referencing earlier cells short-circuits a same-note division-by-zero guard', () => {
        const blocks = scanInlineCalcs('`divisor=0`\n`safe=if(divisor != 0, 10/divisor, 0)`');
        assert.equal(blocks[1].evalResult.ok, true);
        assert.equal(blocks[1].evalResult.value, 0);
    });

    test('a cell named "and", "or", "not", or "if" is rejected as a reserved keyword', () => {
        const blocks = scanInlineCalcs('`and=1`\n`or=2`\n`not=3`\n`if=4`');
        for (const block of blocks) {
            assert.equal(block.evalResult.ok, false);
            assert.equal(block.evalResult.code, 'VALUE');
            assert.match(block.evalResult.error, /Name reserved: ".+" is a keyword/i);
        }
    });
});

describe('scanInlineCalcs — typed error codes', () => {
    test('every failure has a code, not just an error message', () => {
        const blocks = scanInlineCalcs('`=1+`\n`=foo(1)`\n`=total*2`');
        for (const block of blocks) {
            assert.equal(block.evalResult.ok, false);
            assert.equal(typeof block.evalResult.code, 'string');
        }
    });

    test('an out-of-range Y<N> reference is reclassified as REF, not NAME, and reads as a broken reference', () => {
        const blocks = scanInlineCalcs('`=1+1`\n`=Y5*2`');
        assert.equal(blocks[1].evalResult.code, 'REF');
        assert.match(blocks[1].evalResult.error, /Y5 does not exist/i);
        assert.doesNotMatch(blocks[1].evalResult.error, /unknown variable/i);
    });

    test('a missing Y<N> endpoint inside a range is reclassified as REF through the real scanner', () => {
        const blocks = scanInlineCalcs('`=1`\n`=2`\n`=3`\n`=sum(Y1:Y5)`');
        assert.equal(blocks[3].evalResult.code, 'REF');
        assert.match(blocks[3].evalResult.error, /Y5 does not exist/i);
        assert.doesNotMatch(blocks[3].evalResult.error, /unknown variable/i);
    });

    test('a forward-referenced NAMED cell stays NAME, not REF — only the Y<N> shape gets reclassified', () => {
        const blocks = scanInlineCalcs('`=total*2`\n`total=1+2`');
        assert.equal(blocks[0].evalResult.code, 'NAME');
        assert.equal(blocks[0].evalResult.identifier, 'total');
    });

    test('an unknown function is tagged NAME, not REF', () => {
        const blocks = scanInlineCalcs('`=foo(1)`');
        assert.equal(blocks[0].evalResult.code, 'NAME');
        assert.equal(blocks[0].evalResult.identifier, 'foo');
    });

    test('division by zero is tagged DIV0', () => {
        const blocks = scanInlineCalcs('`=1/0`');
        assert.equal(blocks[0].evalResult.code, 'DIV0');
    });

    test('a reserved-name collision (function name or Y<N> shape) is tagged VALUE', () => {
        const blocks = scanInlineCalcs('`sqrt=1`\n`Y1=1`');
        assert.equal(blocks[0].evalResult.code, 'VALUE');
        assert.equal(blocks[1].evalResult.code, 'VALUE');
    });

    test('ERROR_CODE_LABELS has a human badge for every code this module can produce, plus the reserved CYCLE placeholder', () => {
        assert.equal(ERROR_CODE_LABELS.REF, '#REF!');
        assert.equal(ERROR_CODE_LABELS.DIV0, '#DIV/0!');
        assert.equal(ERROR_CODE_LABELS.NAME, '#NAME?');
        assert.equal(ERROR_CODE_LABELS.VALUE, '#VALUE!');
        assert.equal(ERROR_CODE_LABELS.CYCLE, '#CYCLE!');
    });
});

describe('scanInlineCalcs — cross-note references ([[note]]^label)', () => {
    test('with no resolveCrossNoteRef option (every existing caller today), a cross-note ref fails honestly as REF, not a parse error', () => {
        const blocks = scanInlineCalcs('`=[[budget]]^total + 10`');
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal(blocks[0].evalResult.code, 'REF');
        assert.match(blocks[0].evalResult.error, /cross-note references aren't available here/i);
    });

    test('a successful resolver result is substituted in and composes normally with the rest of the expression', () => {
        const resolver = (noteId, label) => (noteId === 'budget' && label === 'total') ? { ok: true, value: 42 } : { ok: false, reason: 'not found' };
        const blocks = scanInlineCalcs('`=[[budget]]^total + 10`', { resolveCrossNoteRef: resolver });
        assert.equal(blocks[0].evalResult.ok, true);
        assert.equal(blocks[0].evalResult.value, 52);
    });

    test('a resolver rejection is surfaced as REF with the resolver\'s own reason, not a generic message', () => {
        const resolver = () => ({ ok: false, reason: 'note "missing" does not exist' });
        const blocks = scanInlineCalcs('`=[[missing]]^total`', { resolveCrossNoteRef: resolver });
        assert.equal(blocks[0].evalResult.code, 'REF');
        assert.match(blocks[0].evalResult.error, /note "missing" does not exist/);
    });

    test('mixes with a same-note reference in the same expression', () => {
        const resolver = () => ({ ok: true, value: 42 });
        const blocks = scanInlineCalcs('`base=5`\n`=base + [[budget]]^total`', { resolveCrossNoteRef: resolver });
        assert.equal(blocks[1].evalResult.value, 47);
    });

    test('multiple cross-note refs in one expression all resolve independently', () => {
        const resolver = (noteId) => noteId === 'a' ? { ok: true, value: 10 } : { ok: true, value: 20 };
        const blocks = scanInlineCalcs('`=[[a]]^x + [[b]]^y`', { resolveCrossNoteRef: resolver });
        assert.equal(blocks[0].evalResult.value, 30);
    });

    test('a cross-note ref is not reported as a same-note dependency', () => {
        const resolver = () => ({ ok: true, value: 42 });
        const blocks = scanInlineCalcs('`=[[budget]]^total`', { resolveCrossNoteRef: resolver });
        assert.deepEqual(blocks[0].deps, []);
    });

    test('a failing resolver never leaks a stale or partial value — the whole block fails, no partial evaluation', () => {
        const resolver = () => ({ ok: false, reason: 'unreachable' });
        const blocks = scanInlineCalcs('`=1 + [[budget]]^total + 1`', { resolveCrossNoteRef: resolver });
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal('value' in blocks[0].evalResult, false);
    });
});

describe('scanInlineCalcs — frontmatter values stored as text', () => {
    test('numeric and boolean strings from the vault index work as numbers and booleans', () => {
        const blocks = scanInlineCalcs('`=squad_size-casualties`\n`=approved and budget>3000`', {
            frontmatterFields: { squad_size: '9', casualties: '1', approved: 'true', budget: '4000' }
        });
        assert.equal(blocks[0].evalResult.value, 8);
        assert.equal(blocks[1].evalResult.value, true);
    });

    test('plain text values stay text', () => {
        const blocks = scanInlineCalcs('`=priority + "!"`', { frontmatterFields: { priority: 'high' } });
        assert.equal(blocks[0].evalResult.value, 'high!');
    });
});

describe('named ranges and conditional aggregates', () => {
    const NOTE = [
        '`=40`', '`=55`', '`=42`', '`=38`',
        '`cost=Y1:Y4`',
        '`=median(cost)`',
        '`=sumif(cost, ">40")`',
        '`=countif(cost, ">=42")`',
        '`=averageif(cost, "<50")`',
    ].join('\n');

    test('a named range can be passed to a function like a list of cells', () => {
        const blocks = scanInlineCalcs(NOTE);
        assert.equal(blocks[5].evalResult.value, 41);
    });

    test('sumif, countif, and averageif apply a criterion to a range', () => {
        const blocks = scanInlineCalcs(NOTE);
        assert.equal(blocks[6].evalResult.value, 97);
        assert.equal(blocks[7].evalResult.value, 2);
        assert.equal(blocks[8].evalResult.value, 40);
    });

    test('sumif with a separate sum range adds the matching cells from that range', () => {
        const blocks = scanInlineCalcs('`=1`\n`=2`\n`=3`\n`lo=Y1:Y2`\n`hi=Y2:Y3`\n`=sumif(lo, "<2", hi)`');
        assert.equal(blocks[5].evalResult.value, 2);
    });

    test('a range name without a name is rejected with a clear message', () => {
        const blocks = scanInlineCalcs('`=1`\n`=2`\n`=Y1:Y2`');
        assert.equal(blocks[2].evalResult.ok, false);
        assert.match(blocks[2].evalResult.error, /needs a name/);
    });

    test('a cross-note range reads each cell in the range from the other note', () => {
        const resolver = (noteId, label) => ({ ok: true, value: { Y1: 10, Y2: 20, Y3: 30 }[label] });
        const blocks = scanInlineCalcs('`=sum([[other]]^Y1:Y3)`', { resolveCrossNoteRef: resolver });
        assert.equal(blocks[0].evalResult.value, 60);
    });
});

describe('table range references (T1.field)', () => {
    const fakeResolver = (label, field) => {
        if (label === 'T1' && field === 'budget') return { ok: true, values: [100, 200, 300] };
        if (label === 'T1' && field === 'missing') return { ok: false, reason: 'that table has no column named "missing"' };
        return { ok: false, reason: `no such table "${label}"` };
    };

    test('a table reference expands into the function it is used in', () => {
        const blocks = scanInlineCalcs('`=sum(T1.budget)`', { resolveTableRange: fakeResolver });
        assert.equal(blocks[0].evalResult.value, 600);
    });

    test('conditional functions work over a table column the same as a named range', () => {
        const blocks = scanInlineCalcs('`=countif(T1.budget, ">150")`', { resolveTableRange: fakeResolver });
        assert.equal(blocks[0].evalResult.value, 2);
    });

    test('an unknown column surfaces the resolver\'s own reason as a #REF! error', () => {
        const blocks = scanInlineCalcs('`=sum(T1.missing)`', { resolveTableRange: fakeResolver });
        assert.equal(blocks[0].evalResult.ok, false);
        assert.equal(blocks[0].evalResult.code, 'REF');
        assert.match(blocks[0].evalResult.error, /no column named "missing"/);
    });

    test('no resolver at all is an honest "not available here", like cross-note references', () => {
        const blocks = scanInlineCalcs('`=sum(T1.budget)`');
        assert.equal(blocks[0].evalResult.ok, false);
        assert.match(blocks[0].evalResult.error, /table references aren.t available here/);
    });

    test('a table reference and a cross-note reference compose in the same formula', () => {
        const resolver = (noteId, label) => ({ ok: true, value: { Y1: 5 }[label] });
        const blocks = scanInlineCalcs('`=sum(T1.budget) + [[other]]^Y1`', { resolveTableRange: fakeResolver, resolveCrossNoteRef: resolver });
        assert.equal(blocks[0].evalResult.value, 605);
    });
});
