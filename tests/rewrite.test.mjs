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

await check('2029 字开场白：只改含八股的那一句，其他一字不动', async () => {
    const bad = '{{char}}嘴角勾起一抹若有若无的弧度。';
    const prefix = `<content>\n${bad}\n\n`, suffix = '\n</content>';
    const original = prefix + '他把书放回桌上，转身关窗。\n'.repeat(200).slice(0, 2029 - prefix.length - suffix.length) + suffix;
    const result = await rewrite(original, options(''), [edits([['s1', '{{char}}笑了笑。']])]);
    assert.equal(result, original.replace(bad, '{{char}}笑了笑。'));
    assert.equal(requests.length, 1);
    assert.ok(requests[0][0].prompt.includes(bad));
});
await check('目标是整句，并附带命中的八股和前后句', () => {
    const text = '窗外在下雨。他推门进来，嘴角勾起一抹弧度。她没抬头。';
    const t = engine.editTargets(text, options(''));
    assert.equal(t.length, 1);
    assert.equal(t[0].text, '他推门进来，嘴角勾起一抹弧度。');
    assert.equal(t[0].prev, '窗外在下雨。');
    assert.equal(t[0].next, '她没抬头。');
    assert.ok(t[0].hits.some(h => h.match.includes('弧度')));
});
await check('长短不限：短句可以改长，整句可以删空', async () => {
    const text = '时间仿佛停滞了。他低笑。她转身离开。';
    const out = await rewrite(text, options('低笑'), [edits([['s1', ''], ['s2', '他笑了一下，没有接话，把杯子推到她面前。']])]);
    assert.equal(out, '他笑了一下，没有接话，把杯子推到她面前。她转身离开。');
    assert.equal(engine.editIssue({ text: '很长的一句话'.repeat(30) }, '短'), '');
});
await check('丢了宏的结果会单句重做', async () => {
    const out = await rewrite('{{char}}低笑。', options('低笑'), [edits([['s1', '他笑了。']]), '{{char}}笑了。']);
    assert.equal(out, '{{char}}笑了。');
    assert.equal(requests.length, 2);
    assert.ok(requests[1][0].prompt.includes('宏'));
});
await check('还含必改词或没改的句子会重做，重做失败保留原句并提示', async () => {
    const out = await rewrite('他低笑。她垂眸。', options('低笑\n垂眸'), [edits([['s1', '他低笑着。'], ['s2', '她低头。']]), '他仍在低笑。']);
    assert.equal(out, '他低笑。她低头。');
    assert.ok(sandbox.item.rewriteWarnings.some(x => x.includes('没改好')));
});
await check('标签、代码、链接不进句子；对白里的普通八股不算，必改词算', () => {
    const text = '<p>极其</p>\n```极其```\n“她极其冷淡。”他说。\n“低笑。”她说。';
    const t = engine.editTargets(text, options('低笑'));
    assert.deepEqual(t.map(x => x.text), ['“低笑。”']);
});
await check('一批 10 句，网络中断保留已完成的修改', async () => {
    const text = Array.from({ length: 11 }, (_, i) => `第${i + 1}次低笑。`).join('');
    const first = edits(Array.from({ length: 10 }, (_, i) => [`s${i + 1}`, `第${i + 1}次笑了。`]));
    const out = await rewrite(text, options('低笑'), [first, new Error('网络中断')]);
    assert.equal(out, Array.from({ length: 11 }, (_, i) => `第${i + 1}次${i < 10 ? '笑了' : '低笑'}。`).join(''));
    assert.ok(sandbox.item.rewriteWarnings.length);
});
await check('旧默认提示词迁移到整句约束，自定义提示词保留', async () => {
    ctx.extensionSettings.baguCleaner = { version: 4, aiPrompt: engine.V4_AI_PROMPT, mode: 'api' };
    assert.equal(evaluate('settings().aiPrompt'), engine.DEFAULT_AI_PROMPT);
    assert.equal(evaluate('settings().version'), 5);
    ctx.extensionSettings.baguCleaner = { version: 4, aiPrompt: '保留轻松的语气\n\n' + engine.V4_EDIT_CONTRACT };
    assert.equal(evaluate('settings().aiPrompt'), '保留轻松的语气');
    await rewrite('他低笑。', options('低笑'), [edits([['s1', '他笑了。']])]);
    assert.ok(requests[0][0].systemPrompt.includes('保留轻松的语气'));
    assert.ok(requests[0][0].systemPrompt.includes(engine.EDIT_CONTRACT));
});
console.log(`PASS ${passed} regression checks; API responses were simulated.`);
