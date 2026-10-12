import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const engine = await import('data:text/javascript;base64,' + fs.readFileSync(new URL('engine.js', root)).toString('base64'));
let source = fs.readFileSync(new URL('index.js', root), 'utf8').replace(/import \{[\s\S]*?\} from '.\/engine.js';/, '');
source = source.slice(0, source.lastIndexOf('jQuery(async'));
const ctx = { extensionSettings: {}, saveSettingsDebounced() {} };
const sandbox = vm.createContext({ ...engine, structuredClone, console, SillyTavern: { getContext: () => ctx } });
vm.runInContext(source + '\nrenderOne = () => {};', sandbox);
const evaluate = code => vm.runInContext(code, sandbox);
let requests = [], passed = 0;
function mock(responses, positional = false) {
    requests = [];
    const respond = async args => {
        requests.push(args);
        assert.ok(responses.length, 'Unexpected extra API request');
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next() : next;
    };
    ctx.generateRaw = positional ? async function (prompt, ...rest) { return respond([prompt, ...rest]); } : async (...args) => respond(args);
    evaluate('state.abort = false;');
}
const edits = list => JSON.stringify({ edits: list.map(([id, text]) => ({ id, text })) });
const options = userWords => ({ ...engine.buildRules({ userWords }), protectQuotes: true });
async function rewrite(text, opts, responses, onlyHit = true) {
    Object.assign(sandbox, { input: text, opts, item: { kind: '额外开场白', id: 'test' }, onlyHit });
    mock(responses);
    return evaluate('apiRewrite(input, item, opts, onlyHit)');
}
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

await check('2029-character opening preserves every byte outside the changed phrase', async () => {
    const phrase = '嘴角勾起一抹若有若无的弧度';
    const prefix = `<content>\n{{char}}${phrase}。\n\n`, suffix = '\n</content>';
    const original = prefix + '他把书放回桌上，转身关窗。\n'.repeat(200).slice(0, 2029 - prefix.length - suffix.length) + suffix;
    assert.equal(original.length, 2029);
    const result = await rewrite(original, options(phrase), [edits([['s1', '轻轻笑了笑']])]);
    assert.equal(result, original.replace(phrase, '轻轻笑了笑'));
    assert.ok(result.length > 1900);
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0].trimNames, false);
    assert.equal(requests[0][0].responseLength, null);
});
await check('repeated words get independent replacements and preserve whitespace', async () => {
    assert.equal(await rewrite('😀他低笑。\r\n\r\n\t她低笑，递来书。  ', options('低笑'), [edits([['s1', '笑了'], ['s2', '轻笑']])]), '😀他笑了。\r\n\r\n\t她轻笑，递来书。  ');
});
await check('overlapping matches form one complete target', () => {
    const text = '他低笑了一声，继续看书。', targets = engine.editTargets(text, options('低笑\n低笑了一声'));
    assert.equal(targets.length, 1);
    assert.equal(targets[0].text, '低笑了一声');
    assert.equal(engine.applyEdits(text, targets, new Map([['s1', '笑了笑']])), '他笑了笑，继续看书。');
});
await check('must rules protect macros, tags, code and links while inspecting dialogue', async () => {
    const text = '{{低笑}} <低笑> ```低笑\n低笑``` https://example.test/低笑 [低笑](https://example.test) “低笑”。', opts = options('低笑');
    assert.equal(engine.editTargets(text, opts).length, 1);
    assert.equal(engine.mustHits(text, opts).length, 1);
    assert.equal(await rewrite(text, opts, [edits([['s1', '笑着']])]), text.replace('“低笑”', '“笑着”'));
});
await check('short phrases can shorten naturally without permitting empty information', () => {
    const target = { text: '嘴角勾起一抹若有若无的弧度', canDelete: false };
    assert.equal(engine.editIssue(target, '笑了笑'), '');
    assert.ok(engine.editIssue(target, ''));
    assert.ok(engine.editIssue(target, '{{char}}笑了笑'));
});
await check('safe modifier deletion respects original lookahead and merged content', async () => {
    const text = '他极其紧张，露出一丝笑意。', opts = options('');
    assert.deepEqual(engine.editTargets(text, opts).map(t => [t.text, t.canDelete]), [['极其', true], ['一丝', true]]);
    assert.equal(await rewrite(text, opts, [edits([['s1', ''], ['s2', '']])]), '他紧张，露出笑意。');
    assert.equal(engine.editTargets('他极其紧张。', options('极其紧张'))[0].canDelete, false);
});
await check('a 200-character fragment reduced to one character gets a local rewrite', async () => {
    const long = '他拿起桌上的书，问朋友明天几点出发。'.repeat(20).slice(0, 200), replacement = long.replaceAll('拿起', '收起');
    assert.ok(engine.editIssue({ text: long, canDelete: false }, '笑'));
    assert.equal(await rewrite(`开头。\n${long}\n结尾。`, options(long), [edits([['s1', '笑']]), replacement]), `开头。\n${replacement}\n结尾。`);
    assert.equal(requests.length, 2);
    assert.ok(requests[1][0].prompt.includes(long));
});
await check('invalid and duplicate ids preserve other valid batch entries', async () => {
    const raw = JSON.stringify({ edits: [{ id: 's1', text: '笑了' }, { id: 's2', text: '看着' }, { id: 's2', text: '望着' }, { id: 's3', text: 1 }] });
    const parsed = engine.parseEdits(raw);
    assert.equal(parsed.get('s1'), '笑了');
    assert.equal(parsed.has('s2'), false);
    assert.equal(parsed.has('s3'), false);
    assert.equal(await rewrite('他低笑，她垂眸。', options('低笑\n垂眸'), [raw, '低头']), '他笑了，她低头。');
    assert.equal(requests.length, 2);
    assert.ok(requests[1][0].prompt.includes('【需要重新写的片段】垂眸'));
});
await check('missing entries retry only missing targets', async () => {
    assert.equal(await rewrite('他低笑，她垂眸。', options('低笑\n垂眸'), [edits([['s2', '低头']]), '笑了']), '他笑了，她低头。');
    assert.equal(requests.length, 2);
    assert.ok(requests[1][0].prompt.includes('【需要重新写的片段】低笑'));
});
await check('a failed local retry retains later valid edits in the same batch', async () => {
    assert.equal(await rewrite('他低笑，她垂眸。', options('低笑\n垂眸'), [edits([['s2', '低头']]), new Error('502')]), '他低笑，她低头。');
    assert.ok(sandbox.item.rewriteWarnings.some(x => x.includes('API')));
});
await check('unchanged retry marks only its fragment and keeps other edits', async () => {
    assert.equal(await rewrite('他低笑，她垂眸。', options('低笑\n垂眸'), [edits([['s1', '低笑'], ['s2', '低头']]), '低笑']), '他低笑，她低头。');
    assert.ok(sandbox.item.rewriteWarnings.some(x => x.includes('低笑')));
});
await check('network interruption after eight targets preserves completed changes', async () => {
    const text = Array.from({ length: 9 }, (_, i) => `第${i + 1}次低笑。`).join('');
    const first = edits(Array.from({ length: 8 }, (_, i) => [`s${i + 1}`, '笑了']));
    assert.equal(await rewrite(text, options('低笑'), [first, new Error('网络中断')]), Array.from({ length: 9 }, (_, i) => `第${i + 1}次${i < 8 ? '笑了' : '低笑'}。`).join(''));
    assert.ok(sandbox.item.rewriteWarnings.length);
});
await check('v3 prompts migrate to v4 while custom instructions remain active', async () => {
    ctx.extensionSettings.baguCleaner = { version: 3, aiPrompt: engine.PREVIOUS_AI_PROMPT, mode: 'rules' };
    assert.equal(evaluate('settings().aiPrompt'), engine.DEFAULT_AI_PROMPT);
    assert.equal(evaluate('settings().version'), 4);
    assert.equal(evaluate('settings().mode'), 'api');
    ctx.extensionSettings.baguCleaner = { version: 3, aiPrompt: '保留轻松的叙述语气' };
    assert.equal(evaluate('settings().aiPrompt'), '保留轻松的叙述语气');
    await rewrite('他低笑。', options('低笑'), [edits([['s1', '笑了']])]);
    assert.ok(requests[0][0].systemPrompt.includes('保留轻松的叙述语气'));
    assert.ok(requests[0][0].systemPrompt.includes(engine.EDIT_CONTRACT));
});
await check('legacy generateRaw preserves response budget and disables name trimming', async () => {
    mock(['返回'], true);
    assert.equal(await evaluate("callLLM('编辑约束', '目标', 3)"), '返回');
    assert.equal(requests[0][5], null);
    assert.equal(requests[0][6], false);
});
await check('mixed mode sends original content without pre-deleting a matched clause', async () => {
    Object.assign(sandbox, { opts: { ...engine.buildRules({ customRules: '删除: 小明低笑[^。]*。' }), protectQuotes: true }, item: { before: '小明低笑，拿起桌上的书。\n\n朋友在门口等他。', kind: '额外开场白', id: 'mixed' } });
    evaluate("settings().mode = 'both'");
    mock([edits([['s1', '小明笑了笑，拿起桌上的书。']])]);
    await evaluate('processItem(item, opts)');
    assert.equal(sandbox.item.after, '小明笑了笑，拿起桌上的书。\n\n朋友在门口等他。');
    assert.equal(sandbox.item.status, 'ready');
    assert.ok(requests[0][0].prompt.includes('小明低笑，拿起桌上的书。'));
});
console.log(`PASS ${passed} regression checks; API responses were simulated.`);
