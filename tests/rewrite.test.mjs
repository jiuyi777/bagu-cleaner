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
let requests = [];
function mock(responses) {
    requests = [];
    ctx.generateRaw = async (...args) => { requests.push(args[0]); if (!responses.length) throw Error('unexpected request'); return responses.shift(); };
    evaluate('state.abort = false;');
}
const original = '小明低笑，拿起桌上的书，走到门口问朋友明天几点出发。'.repeat(8);
const rewritten = original.replaceAll('低笑', '笑着');
sandbox.original = original;
sandbox.rewritten = rewritten;
sandbox.opts = engine.buildRules({ userWords: '低笑' });
assert.ok(engine.rewriteIssue('字'.repeat(2029), '字'.repeat(167)));
assert.equal(engine.rewriteIssue(original, rewritten), '');
mock(['很短。', rewritten]);
let result = await evaluate("rewriteChunk('开场白', original, opts)");
assert.equal(result.text, rewritten);
assert.equal(requests.length, 2);
assert.ok(requests[1].prompt.includes(original));
assert.ok(requests[1].prompt.includes('重新写出完整的一段'));
mock(['短。','仍短。',rewritten]);
result = await evaluate("rewriteChunk('开场白', original, opts)");
assert.equal(result.text, rewritten);
assert.equal(requests.length, 3);
mock(['短。','仍短。','又短。']);
await assert.rejects(evaluate("rewriteChunk('开场白', original, opts)"), /连续 3 次/);
// A destructive retry cannot replace a previously complete rewrite.
mock([original.replaceAll('小明','小李'), '短。','短。']);
result = await evaluate("rewriteChunk('开场白', original, opts)");
assert.ok(result.text.length >= original.length * .8);
// Unmatched paragraphs and whitespace remain byte-for-byte unchanged.
mock([rewritten]);
sandbox.item = {kind:'开场白'};
result = await evaluate("apiRewrite('平静的早晨。\\n\\n' + original + '\\n结尾。', item, opts, true)");
assert.equal(result, '平静的早晨。\n\n' + rewritten + '\n结尾。');
assert.equal(requests.length, 1);
// Saved settings upgrade; custom prompts persist and still get the contract.
ctx.extensionSettings.baguCleaner = {version:2, aiPrompt:engine.LEGACY_AI_PROMPT};
assert.equal(evaluate('settings().aiPrompt'), engine.DEFAULT_AI_PROMPT);
ctx.extensionSettings.baguCleaner = {version:2, aiPrompt:'自定义编辑风格'};
assert.equal(evaluate('settings().aiPrompt'), '自定义编辑风格');
mock([rewritten]);
await evaluate("rewriteChunk('开场白', original, opts)");
assert.ok(requests[0].systemPrompt.includes(engine.EDIT_CONTRACT));
// Mixed mode must send untouched original, even with a destructive custom rule.
evaluate("settings().mode = 'both'");
sandbox.opts = engine.buildRules({customRules:'删除: 小明低笑[^。]*。'});
sandbox.item = {before:original,kind:'开场白',id:'test'};
mock([rewritten]);
await evaluate('processItem(item, opts)');
assert.equal(sandbox.item.after, rewritten);
assert.ok(requests[0].prompt.includes(original));
// Rule-only excessive deletion never creates a writable result.
evaluate("settings().mode = 'rules'");
sandbox.item = {before:original+'结尾。',kind:'开场白',id:'test',after:'旧结果'};
await evaluate('processItem(item, opts)');
assert.equal(sandbox.item.status, 'error');
assert.equal(sandbox.item.after, null);
// Cancellation cannot expose a partial generated item.
evaluate("settings().mode = 'api'");
sandbox.opts = engine.buildRules({userWords:'低笑'});
sandbox.item = {before:original,kind:'开场白',id:'test'};
ctx.generateRaw = async () => { evaluate('state.abort = true'); return rewritten; };
await evaluate('processItem(item, opts)');
assert.equal(sandbox.item.status, 'error');
assert.equal(sandbox.item.after, null);
console.log('PASS: short output regeneration, retry exhaustion, full original prompts, per-paragraph preservation, settings migration, mixed/rule modes, cancellation');
