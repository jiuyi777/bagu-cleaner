// 八股清理 · SillyTavern 扩展
import {
    RULE_GROUPS, DEFAULT_RULES, DEFAULT_AI_PROMPT, buildRules, cleanText, scanText,
    looksLikeInstructions, diffText, protectStats, splitChunks, mustHits, hitList,
    LEGACY_AI_PROMPT, EDIT_CONTRACT, rewriteIssue,
} from './engine.js';

const MODULE = 'baguCleaner';
const SETTINGS_VERSION = 3;
const getCtx = () => SillyTavern.getContext();

const CHAR_FIELDS = [
    { key: 'description', label: '角色描述' },
    { key: 'personality', label: '性格摘要' },
    { key: 'scenario', label: '场景' },
    { key: 'first_mes', label: '开场白' },
    { key: 'alternate_greetings', label: '额外开场白（全部）', array: true },
    { key: 'mes_example', label: '对话示例' },
    { key: 'system_prompt', label: '系统提示词' },
    { key: 'post_history_instructions', label: '历史后指令' },
    { key: 'character_book', label: '内嵌世界书', book: true },
];
const TOP_FIELDS = new Set(['description', 'personality', 'scenario', 'first_mes', 'mes_example']);
const TEXTAREAS = {
    description: '#description_textarea',
    personality: '#personality_textarea',
    scenario: '#scenario_pole',
    first_mes: '#firstmessage_textarea',
    mes_example: '#mes_example_textarea',
    system_prompt: '#system_prompt_textarea',
    post_history_instructions: '#post_history_instructions_textarea',
};

const DEFAULTS = {
    version: SETTINGS_VERSION,
    ruleOverrides: {},
    disabledGroups: [],
    customRules: '',
    userWords: '',
    aiPrompt: DEFAULT_AI_PROMPT,
    protectQuotes: true,
    skipInstructions: true,
    includeDisabledEntries: true,
    mode: 'api',
    apiProfile: '',
    fields: Object.fromEntries(CHAR_FIELDS.map((f) => [f.key, true])),
    worldsPicked: null, // null = 首次使用，默认勾选“当前启用”的世界书
    lastBackup: null,
};

const state = { items: [], busy: false, abort: false, root: null, seq: 0, open: new Set() };

// ───────────── 设置 ─────────────

function settings() {
    const ext = getCtx().extensionSettings;
    ext[MODULE] ??= {};
    const s = ext[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    if ((s.version ?? 1) < SETTINGS_VERSION) {
        s.mode = 'api';
        s.includeDisabledEntries = true;
        if (s.aiPrompt === LEGACY_AI_PROMPT) s.aiPrompt = DEFAULT_AI_PROMPT;
        s.version = SETTINGS_VERSION;
    }
    for (const f of CHAR_FIELDS) s.fields[f.key] ??= true;
    return s;
}
const save = () => getCtx().saveSettingsDebounced();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ruleOpts() {
    const s = settings();
    const { rules, errors } = buildRules(s);
    return { rules, errors, protectQuotes: s.protectQuotes };
}

// ───────────── 世界书 ─────────────

let WI = null;
async function wi() {
    if (!WI) {
        try { WI = await import('../../../world-info.js'); } catch { WI = {}; }
    }
    return WI;
}
async function listWorlds() {
    const m = await wi();
    return [...(m.world_names ?? getCtx().world_names ?? [])];
}
/** 当前生效的世界书：全局选中 + 聊天绑定 + 角色主绑定 + 角色附加 */
async function activeWorlds() {
    const m = await wi();
    const c = getCtx();
    const set = new Set(m.selected_world_info ?? []);
    const chatLore = c.chatMetadata?.world_info;
    if (chatLore) set.add(chatLore);
    const ch = currentChar();
    if (ch) {
        if (ch.data?.extensions?.world) set.add(ch.data.extensions.world);
        const file = String(ch.avatar || '').replace(/\.[^.]+$/, '');
        const extra = m.world_info?.charLore?.find((e) => e.name === file)?.extraBooks ?? [];
        extra.forEach((b) => set.add(b));
    }
    return set;
}
async function charWorlds() {
    const m = await wi();
    const set = new Set();
    const ch = currentChar();
    if (!ch) return set;
    if (ch.data?.extensions?.world) set.add(ch.data.extensions.world);
    const file = String(ch.avatar || '').replace(/\.[^.]+$/, '');
    (m.world_info?.charLore?.find((e) => e.name === file)?.extraBooks ?? []).forEach((b) => set.add(b));
    return set;
}
async function loadWorld(name) {
    const f = getCtx().loadWorldInfo ?? (await wi()).loadWorldInfo;
    if (!f) throw new Error('当前版本取不到 loadWorldInfo');
    return await f(name);
}
async function saveWorld(name, data) {
    const c = getCtx();
    const m = await wi();
    const f = c.saveWorldInfo ?? m.saveWorldInfo;
    if (!f) throw new Error('当前版本取不到 saveWorldInfo');
    await f(name, data, true);
    try { (c.reloadWorldInfoEditor ?? m.reloadEditor)?.(name); } catch { /* 编辑器没开时忽略 */ }
}

// ───────────── 角色 ─────────────

function currentChar() {
    const c = getCtx();
    if (c.groupId || c.characterId === undefined || c.characterId === null || c.characterId === '') return null;
    return c.characters?.[c.characterId] ?? null;
}
const charValue = (ch, key) => ch?.data?.[key] ?? ch?.[key];

// ───────────── 收集条目 ─────────────

function rescan(it) {
    it.scan = scanText(it.before, ruleOpts());
}

function mkItem(o) {
    const s = settings();
    const it = { id: ++state.seq, ...o, before: o.text, after: null, status: 'idle', error: '', warn: '', left: [] };
    delete it.text;
    it.instr = looksLikeInstructions(it.before);
    rescan(it);
    it.checked = it.scan.total > 0 && !(it.instr && s.skipInstructions) && !(it.entryDisabled && !s.includeDisabledEntries);
    return it;
}

async function collectItems(fields, worlds) {
    const items = [];
    const ch = currentChar();
    if (ch) {
        const base = { source: 'char', avatar: ch.avatar, charName: ch.name };
        for (const f of CHAR_FIELDS) {
            if (!fields.has(f.key)) continue;
            if (f.array) {
                (ch.data?.alternate_greetings || []).forEach((t, i) => {
                    if (t?.trim()) items.push(mkItem({ ...base, field: f.key, index: i, label: `额外开场白 ${i + 1}`, kind: '开场白', text: t }));
                });
            } else if (f.book) {
                (ch.data?.character_book?.entries || []).forEach((e, i) => {
                    if (!e?.content?.trim()) return;
                    const name = e.comment || e.name || (e.keys || []).join('/') || `#${i}`;
                    items.push(mkItem({ ...base, field: 'character_book', index: i, label: `内嵌世界书 · ${name}`, kind: '世界书条目', text: e.content, entryDisabled: e.enabled === false }));
                });
            } else {
                const t = charValue(ch, f.key);
                if (t?.trim()) items.push(mkItem({ ...base, field: f.key, label: f.label, kind: f.label, text: t }));
            }
        }
    }
    for (const name of worlds) {
        let data;
        try { data = await loadWorld(name); } catch (e) { toastr.warning(`读取世界书 ${name} 失败：${e.message || e}`); continue; }
        for (const [uid, e] of Object.entries(data?.entries || {})) {
            if (!e?.content?.trim()) continue;
            const title = e.comment || (e.key || []).join('/') || `#${uid}`;
            items.push(mkItem({ source: 'world', world: name, uid, label: `${name} · ${title}`, kind: '世界书条目', text: e.content, entryDisabled: !!e.disable }));
        }
    }
    return items;
}

// ───────────── 写入 ─────────────

async function writeCharChanges(avatar, changes, expectKey, report) {
    const c = getCtx();
    const ch = c.characters.find((x) => x.avatar === avatar);
    if (!ch) { report.skipped += changes.length; report.notes.push(`找不到角色 ${avatar}`); return; }
    const data = ch.data ?? {};
    const payload = { avatar, data: {} };
    let greetings = null;
    let book = null;
    for (const x of changes) {
        let cur;
        if (x.field === 'alternate_greetings') cur = data.alternate_greetings?.[x.index];
        else if (x.field === 'character_book') cur = data.character_book?.entries?.[x.index]?.content;
        else cur = charValue(ch, x.field);
        if (cur !== x[expectKey]) { report.skipped++; report.notes.push(`${x.label} 期间被改动过，跳过`); continue; }

        if (x.field === 'alternate_greetings') {
            greetings ??= [...(data.alternate_greetings || [])];
            greetings[x.index] = x.value;
        } else if (x.field === 'character_book') {
            book ??= structuredClone(data.character_book);
            book.entries[x.index].content = x.value;
        } else {
            payload.data[x.field] = x.value;
            if (TOP_FIELDS.has(x.field)) payload[x.field] = x.value;
        }
        report.done++;
    }
    if (greetings) payload.data.alternate_greetings = greetings;
    if (book) payload.data.character_book = book;
    if (!Object.keys(payload.data).length) return;

    const res = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: c.getRequestHeaders(),
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`保存角色失败（HTTP ${res.status}）`);

    ch.data ??= {};
    for (const [k, v] of Object.entries(payload.data)) ch.data[k] = v;
    for (const k of TOP_FIELDS) if (k in payload) ch[k] = payload[k];
    if (c.characters[c.characterId]?.avatar === avatar) {
        for (const [k, sel] of Object.entries(TEXTAREAS)) if (k in payload.data) $(sel).val(payload.data[k]);
    }
}

async function writeWorldChanges(name, changes, expectKey, report) {
    const data = await loadWorld(name);
    let n = 0;
    for (const x of changes) {
        const e = data?.entries?.[x.uid];
        if (!e || e.content !== x[expectKey]) { report.skipped++; report.notes.push(`${x.label} 期间被改动过，跳过`); continue; }
        e.content = x.value;
        n++;
    }
    if (n) await saveWorld(name, data);
    report.done += n;
}

async function writeChanges(entries, expectKey) {
    const report = { done: 0, skipped: 0, notes: [] };
    const byChar = new Map();
    const byWorld = new Map();
    for (const e of entries) {
        const map = e.source === 'char' ? byChar : byWorld;
        const key = e.source === 'char' ? e.avatar : e.world;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(e);
    }
    for (const [avatar, list] of byChar) await writeCharChanges(avatar, list, expectKey, report);
    for (const [name, list] of byWorld) await writeWorldChanges(name, list, expectKey, report);
    return report;
}

// ───────────── API ─────────────

function listProfiles() {
    const c = getCtx();
    if (!c.ConnectionManagerRequestService) return [];
    return (c.extensionSettings?.connectionManager?.profiles ?? []).map((p) => ({ id: p.id, name: p.name }));
}

async function callLLM(system, prompt, srcLen) {
    const c = getCtx();
    const responseLength = Math.min(8000, Math.max(400, Math.round(srcLen * 1.6) + 200));
    const profile = settings().apiProfile;
    if (profile && c.ConnectionManagerRequestService) {
        const res = await c.ConnectionManagerRequestService.sendRequest(
            profile,
            [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            responseLength,
        );
        return typeof res === 'string' ? res : (res?.content ?? '');
    }
    if (typeof c.generateRaw !== 'function') throw new Error('当前酒馆版本没有 generateRaw');
    if (c.generateRaw.length === 0) return await c.generateRaw({ prompt, systemPrompt: system, responseLength });
    return await c.generateRaw(prompt, null, false, false, system, responseLength);
}

function tidyLLM(s) {
    return String(s ?? '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/^\s*```[a-z]*\n?/i, '')
        .replace(/\n?```\s*$/, '')
        .replace(/^\s*(?:改写后?(?:的正文)?|正文|输出)\s*[:：]\s*\n?/, '')
        .trim();
}

function buildUserMsg(kind, body, opts) {
    const hits = hitList(body, opts);
    const must = [...new Set(mustHits(body, opts).map((h) => h.match))];
    const seen = new Set();
    const lines = [];
    for (const h of hits) {
        const key = `${h.label}|${h.match}`;
        if (seen.has(key) || h.type === 'must') continue;
        seen.add(key);
        lines.push(`- ${h.label}：「${h.match}」`);
        if (lines.length >= 40) break;
    }
    return `【文本类型】${kind}
【检测到的八股】
${lines.join('\n') || '（无）'}
【必须改掉】${must.length ? must.map((m) => `「${m}」`).join('、') : '（无）'}
【原文】
${body}`;
}

/** 每次都以完整原文为基准；缩短过多的候选不进入结果。 */
async function rewriteChunk(kind, body, opts) {
    const sys = `${settings().aiPrompt}\n\n${EDIT_CONTRACT}`;
    const user = buildUserMsg(kind, body, opts);
    let best = null;
    let bestHits = mustHits(body, opts).length;
    let accepted = false;
    let problem = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        if (state.abort) throw new Error('已停止，本项原文保留');
        const prompt = attempt === 0 ? user : `${user}

【上次处理问题】${problem}
请依据上面原段的动作、对白、细节和事件顺序，重新写出完整的一段。保留原意和叙述语气，换掉命中的表达，正文达到原段的 90%～110%，只输出重写后的段落。`;
        const res = tidyLLM(await callLLM(sys, prompt, body.length));
        if (state.abort) throw new Error('已停止，本项原文保留');
        const issue = rewriteIssue(body, res);
        if (issue) {
            problem = `${issue}。需要恢复原文的动作、对白和细节，只删赘词，其余改写`;
            continue;
        }
        const hits = mustHits(res, opts);
        if (!accepted || hits.length <= bestHits) {
            best = res;
            bestHits = hits.length;
            accepted = true;
        }
        if (!hits.length) return { text: res, warning: '' };
        problem = `以下措辞仍需局部改写：${[...new Set(hits.map(h => h.match))].map(m => `「${m}」`).join('、')}。保留它们所表达的信息`;
    }
    if (!accepted) throw new Error('该段连续 3 次输出过短，本项生成已停止，可点重新生成再处理。');
    return { text: best, warning: '部分词句仍待检查，已保留内容完整的修改稿。' };
}

async function apiRewrite(text, it, opts, onlyHit) {
    const out = [];
    it.rewriteWarnings = [];
    for (const chunk of splitChunks(text, 1)) {
        const lead = chunk.match(/^\s*/)[0];
        const trail = chunk.slice(lead.length).match(/\s*$/)[0];
        const body = chunk.slice(lead.length, chunk.length - trail.length);
        if (state.abort) throw new Error('已停止，本项原文保留');
        if (!body || (onlyHit && scanText(body, opts).total === 0)) { out.push(chunk); continue; }
        const result = await rewriteChunk(it.kind, body, opts);
        out.push(lead + result.text + trail);
        if (result.warning) it.rewriteWarnings.push(result.warning);
    }
    return out.join('');
}

// ───────────── 弹窗 UI ─────────────

const MODES = [
    ['api', '检测到就交给 API 改写', '有命中的段落整段送 API'],
    ['both', '规则检测后交给 API 局部改写', '保留完整原文'],
    ['rules', '只用规则（不调 API）', '本地，秒出'],
    ['ai', '全部交给 API', '没命中也改'],
];

async function popupHtml() {
    const s = settings();
    const ch = currentChar();
    const worlds = await listWorlds();
    const active = await activeWorlds();
    const bound = await charWorlds();
    const picked = new Set(s.worldsPicked ?? [...active]);
    const fields = CHAR_FIELDS.map((f) => `<label><input type="checkbox" class="bagu-field" value="${f.key}" ${s.fields[f.key] ? 'checked' : ''}>${f.label}</label>`).join('');
    const ws = worlds.length
        ? worlds.map((w) => {
            const tags = [bound.has(w) ? '角色' : '', active.has(w) && !bound.has(w) ? '启用中' : ''].filter(Boolean).join('·');
            return `<label class="bagu-world" data-name="${esc(w)}"><input type="checkbox" value="${esc(w)}" ${picked.has(w) ? 'checked' : ''}>${esc(w)}${tags ? ` <small class="bagu-dim">${tags}</small>` : ''}</label>`;
        }).join('')
        : '<div class="bagu-dim">没有世界书</div>';
    const profiles = listProfiles();
    const apiSel = `<select class="text_pole bagu-profile"><option value="">当前连接的 API</option>${profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === s.apiProfile ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
    return `
<div class="bagu">
  <details class="bagu-sec" open>
    <summary class="bagu-title">检查范围</summary>
    <div class="bagu-sub">角色：${ch ? esc(ch.name) : '<span class="bagu-dim">没打开单人角色，只查世界书</span>'}</div>
    ${ch ? `<div class="bagu-grid">${fields}</div>` : ''}
    <div class="bagu-sub">世界书 <span class="bagu-dim">（勾了就查整本，包括没启用的条目）</span></div>
    <div class="bagu-presets">
      <a data-preset="all">全部</a> · <a data-preset="active">当前启用</a> · <a data-preset="bound">角色绑定</a> · <a data-preset="none">清空</a>
      <input class="text_pole bagu-wsearch" placeholder="筛选">
    </div>
    <div class="bagu-worlds">${ws}</div>
    <div class="bagu-grid bagu-opts">
      <label><input type="checkbox" class="bagu-opt" data-key="includeDisabledEntries" ${s.includeDisabledEntries ? 'checked' : ''}>没启用的条目也勾上</label>
      <label><input type="checkbox" class="bagu-opt" data-key="skipInstructions" ${s.skipInstructions ? 'checked' : ''}>不勾规则/提示词条目</label>
      <label><input type="checkbox" class="bagu-opt" data-key="protectQuotes" ${s.protectQuotes ? 'checked' : ''}>规则删除不动对白</label>
    </div>
  </details>
  <details class="bagu-sec">
    <summary class="bagu-title">我的八股词 <span class="bagu-dim">（查到必改）</span></summary>
    <div class="bagu-dim bagu-small-text">每行一个。默认已有「的弧度」。想用正则就写 re: 开头，比如 re:眸(光|色)微(闪|沉)</div>
    <textarea class="text_pole bagu-userwords" rows="4" placeholder="薄唇轻启&#10;眸光微闪&#10;不容置喙"></textarea>
  </details>
  <div class="bagu-sec">
    <div class="bagu-title">改写方式</div>
    <div class="bagu-modes">${MODES.map(([v, t, d]) => `<label><input type="radio" name="bagu-mode" value="${v}" ${s.mode === v ? 'checked' : ''}>${t} <small class="bagu-dim">${d}</small></label>`).join('')}</div>
    <div class="bagu-sub">用哪个 API：${apiSel}</div>
  </div>
  <div class="bagu-actions">
    <div class="menu_button bagu-oneclick bagu-primary">一键检查并改写</div>
  </div>
  <div class="bagu-actions">
    <div class="menu_button bagu-scan">① 检查</div>
    <div class="menu_button bagu-run">② 生成修改</div>
    <div class="menu_button bagu-apply">③ 写入所选</div>
    <div class="menu_button bagu-stop" style="display:none">停止</div>
  </div>
  <div class="bagu-actions bagu-small">
    <div class="menu_button bagu-undo">撤销上次写入</div>
    <div class="menu_button bagu-backup">下载上次备份</div>
  </div>
  <div class="bagu-status"></div>
  <div class="bagu-bulk" style="display:none">
    <a data-sel="all">全选</a> · <a data-sel="none">全不选</a> · <a data-sel="hits">只选有八股的</a> · <a data-sel="changed">只选已生成的</a>
  </div>
  <div class="bagu-list"></div>
</div>`;
}

function statusBadge(it) {
    return {
        running: '<span class="bagu-badge">生成中…</span>',
        ready: '<span class="bagu-badge ok">待写入</span>',
        same: '<span class="bagu-badge">无改动</span>',
        written: '<span class="bagu-badge ok">已写入</span>',
        error: '<span class="bagu-badge bad">出错</span>',
    }[it.status] || '';
}

function renderDiff(a, b) {
    return diffText(a, b).map((o) => {
        const t = esc(o.text);
        if (o.type === 'eq') return t.length > 160 ? `${t.slice(0, 60)}<span class="bagu-dim"> …… </span>${t.slice(-60)}` : t;
        return `<span class="bagu-${o.type}">${t}</span>`;
    }).join('');
}

function leftHtml(it) {
    if (!it.left?.length) return '';
    return `<div class="bagu-warn">还有必改项：${it.left.map((m) => `「${esc(m)}」`).join('、')}</div>`;
}

function renderItem(it) {
    const chips = it.scan.top.slice(0, 14).map((h) => `<span class="bagu-chip ${h.type}">${esc(h.label)}×${h.count}</span>`).join('');
    const badges = [
        it.instr ? '<span class="bagu-badge warn">像规则/提示词</span>' : '',
        it.entryDisabled ? '<span class="bagu-badge">未启用</span>' : '',
        statusBadge(it),
    ].join('');
    const has = it.after != null;
    const open = state.open.has(it.id) ? 'open' : '';
    return `
<div class="bagu-item" data-id="${it.id}">
  <label class="bagu-head">
    <input type="checkbox" class="bagu-check" ${it.checked ? 'checked' : ''}>
    <span class="bagu-label">${esc(it.label)}</span>
  </label>
  <div class="bagu-meta">${it.scan.must ? `<b class="bagu-mustcount">必改 ${it.scan.must}</b> · ` : ''}八股 ${it.scan.auto + it.scan.flag} 处 · ${it.before.length} 字 ${badges}</div>
  ${chips ? `<div class="bagu-chips">${chips}</div>` : ''}
  <details class="bagu-orig"><summary>原文</summary><div class="bagu-diff">${esc(it.before)}</div></details>
  ${has ? `
  <details class="bagu-result" ${open}>
    <summary>修改结果（可以直接改）· ${it.before.length} → ${it.after.length} 字</summary>
    <textarea class="text_pole bagu-editor">${esc(it.after)}</textarea>
    <div class="bagu-left">${leftHtml(it)}</div>
    <details class="bagu-diffwrap"><summary>对比原文</summary><div class="bagu-diff">${renderDiff(it.before, it.after)}</div></details>
    <div class="bagu-item-actions"><a class="bagu-redo">重新生成</a> · <a class="bagu-revert">放弃这项</a></div>
  </details>` : `<div class="bagu-item-actions"><a class="bagu-redo">只生成这一项</a></div>`}
  ${it.warn ? `<div class="bagu-warn">${esc(it.warn)}</div>` : ''}
  ${it.error ? `<div class="bagu-error">${esc(it.error)}</div>` : ''}
</div>`;
}

function $r(sel) { return $(state.root).find(sel); }
function setStatus(msg) { $r('.bagu-status').html(msg); }
function renderList() {
    $r('.bagu-list').html(state.items.map(renderItem).join('') || '<div class="bagu-dim">没有可处理的内容</div>');
    $r('.bagu-bulk').toggle(state.items.length > 0);
}
function renderOne(it) {
    const $el = $r(`.bagu-item[data-id="${it.id}"]`);
    if ($el.length) $el.replaceWith(renderItem(it)); else renderList();
}
function setBusy(b) {
    state.busy = b;
    $r('.bagu-stop').toggle(b);
    $r('.bagu-oneclick, .bagu-scan, .bagu-run, .bagu-apply, .bagu-undo').toggleClass('disabled', b);
}
const findItem = (el) => state.items.find((i) => i.id === Number($(el).closest('.bagu-item').data('id')));

function pickedWorlds() { return $r('.bagu-worlds input:checked').map((_, e) => e.value).get(); }
function savePicked() { settings().worldsPicked = pickedWorlds(); save(); }

async function onScan() {
    if (state.busy) return;
    const fields = new Set($r('.bagu-field:checked').map((_, e) => e.value).get());
    const worlds = pickedWorlds();
    const { errors } = ruleOpts();
    setBusy(true);
    setStatus('检查中…');
    try {
        state.items = await collectItems(fields, worlds);
        state.open.clear();
        const hit = state.items.filter((i) => i.scan.total > 0).length;
        const must = state.items.filter((i) => i.scan.must > 0).length;
        const instr = state.items.filter((i) => i.instr).length;
        setStatus(`共 ${state.items.length} 项，${hit} 项有八股${must ? `，其中 ${must} 项有必改` : ''}。`
            + (instr ? `<br><span class="bagu-dim">${instr} 项像规则/提示词（本身列着禁用词），默认没勾。</span>` : '')
            + (errors.length ? `<div class="bagu-error">${errors.map(esc).join('<br>')}</div>` : ''));
        renderList();
    } catch (e) {
        setStatus(`<span class="bagu-error">检查失败：${esc(e.message || e)}</span>`);
    } finally { setBusy(false); }
}

async function processItem(it, opts) {
    const mode = settings().mode;
    it.error = '';
    it.warn = '';
    it.after = null;
    it.left = [];
    it.rewriteWarnings = [];
    it.status = 'running';
    renderOne(it);
    try {
        let text = it.before;
        if (mode === 'rules') text = cleanText(text, opts).text;
        if (mode !== 'rules') text = await apiRewrite(text, it, opts, mode !== 'ai');
        const issue = rewriteIssue(it.before, text);
        if (issue) {
            throw new Error(`${issue}。请切换 API 局部改写，让模型重新写出承载信息的句子。`);
        }
        it.after = text;
        it.left = [...new Set(mustHits(text, opts).map((h) => h.match))];
        it.status = text === it.before ? 'same' : 'ready';
        it.warn = [...new Set(it.rewriteWarnings), protectStats(it.before, text)].filter(Boolean).join('；');
        if (it.status === 'ready') state.open.add(it.id);
    } catch (e) {
        it.error = String(e?.message || e);
        it.status = 'error';
    }
    renderOne(it);
}

async function runItems(targets) {
    const opts = ruleOpts();
    state.abort = false;
    setBusy(true);
    let n = 0;
    for (const it of targets) {
        if (state.abort) break;
        n++;
        setStatus(`生成中 ${n}/${targets.length}：${esc(it.label)}`);
        await processItem(it, opts);
    }
    setBusy(false);
    const ready = state.items.filter((i) => i.status === 'ready').length;
    const left = state.items.filter((i) => i.left?.length).length;
    setStatus(`${state.abort ? '已停止。' : '生成完了。'}${ready} 项待写入${left ? `，${left} 项还留着必改项（可以手改或重新生成）` : ''}。改完点 ③ 写入。`);
}

async function onOneClick() {
    if (state.busy) return;
    await onScan();
    const targets = state.items.filter((i) => i.checked);
    if (!targets.length) return setStatus('没查到需要改的八股。');
    await runItems(targets);
}

async function onRun() {
    if (state.busy) return;
    const targets = state.items.filter((i) => i.checked);
    if (!targets.length) return setStatus('先点 ① 检查，再勾选要改的条目。');
    await runItems(targets);
}

async function onApply() {
    if (state.busy) return;
    const c = getCtx();
    const items = state.items.filter((i) => i.checked && i.status === 'ready' && i.after !== i.before);
    if (!items.length) return setStatus('没有待写入的修改。');
    const nChar = items.filter((i) => i.source === 'char').length;
    const left = items.filter((i) => i.left?.length).length;
    const ok = await c.callGenericPopup(
        `将写入 ${items.length} 项（角色卡 ${nChar}，世界书条目 ${items.length - nChar}）。${left ? `<br>其中 ${left} 项还留着必改项。` : ''}<br>原文会先备份，可以一键撤销。`,
        c.POPUP_TYPE.CONFIRM,
    );
    if (!ok) return;
    const entries = items.map((i) => ({
        source: i.source, avatar: i.avatar, charName: i.charName, field: i.field, index: i.index,
        world: i.world, uid: i.uid, label: i.label, before: i.before, after: i.after, value: i.after,
    }));
    settings().lastBackup = { time: new Date().toISOString(), entries: entries.map(({ value, ...e }) => e) };
    save();
    setBusy(true);
    try {
        const r = await writeChanges(entries, 'before');
        for (const i of items) {
            i.before = i.after;
            i.after = null;
            i.left = [];
            i.status = 'written';
            state.open.delete(i.id);
            rescan(i);
        }
        renderList();
        setStatus(`已写入 ${r.done} 项${r.skipped ? `，跳过 ${r.skipped} 项：${esc(r.notes.join('；'))}` : ''}。开场白只对新开的聊天生效。`);
        toastr.success(`八股清理：已写入 ${r.done} 项`);
    } catch (e) {
        setStatus(`<span class="bagu-error">写入失败：${esc(e.message || e)}</span>`);
    } finally { setBusy(false); }
}

async function onUndo() {
    if (state.busy) return;
    const c = getCtx();
    const b = settings().lastBackup;
    if (!b?.entries?.length) return toastr.info('没有可撤销的写入记录');
    const ok = await c.callGenericPopup(`撤销 ${new Date(b.time).toLocaleString()} 写入的 ${b.entries.length} 项？`, c.POPUP_TYPE.CONFIRM);
    if (!ok) return;
    setBusy(true);
    try {
        const r = await writeChanges(b.entries.map((e) => ({ ...e, value: e.before })), 'after');
        settings().lastBackup = null;
        save();
        state.items = [];
        renderList();
        setStatus(`已恢复 ${r.done} 项${r.skipped ? `，${r.skipped} 项之后又被改过，没动：${esc(r.notes.join('；'))}` : ''}。`);
    } catch (e) {
        setStatus(`<span class="bagu-error">撤销失败：${esc(e.message || e)}</span>`);
    } finally { setBusy(false); }
}

function onBackup() {
    const b = settings().lastBackup;
    if (!b) return toastr.info('还没有备份');
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `八股清理备份_${b.time.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function bindPopup(root) {
    const $root = $(root);
    const s = settings();
    $root.find('.bagu-userwords').val(s.userWords);

    $root.on('click', '.bagu-oneclick', onOneClick);
    $root.on('click', '.bagu-scan', onScan);
    $root.on('click', '.bagu-run', onRun);
    $root.on('click', '.bagu-apply', onApply);
    $root.on('click', '.bagu-undo', onUndo);
    $root.on('click', '.bagu-backup', onBackup);
    $root.on('click', '.bagu-stop', () => {
        state.abort = true;
        try { getCtx().stopGeneration?.(); } catch { /* ignore */ }
        setStatus('正在停止…');
    });

    $root.on('change', '.bagu-field', function () { s.fields[this.value] = this.checked; save(); });
    $root.on('change', '.bagu-worlds input', savePicked);
    $root.on('click', '.bagu-presets a', async function () {
        const p = this.dataset.preset;
        const set = p === 'active' ? await activeWorlds() : p === 'bound' ? await charWorlds() : null;
        $root.find('.bagu-worlds input').each((_, el) => { el.checked = p === 'all' ? true : p === 'none' ? false : set.has(el.value); });
        savePicked();
    });
    $root.on('input', '.bagu-wsearch', function () {
        const q = this.value.trim().toLowerCase();
        $root.find('.bagu-world').each((_, el) => $(el).toggle(!q || String($(el).data('name')).toLowerCase().includes(q)));
    });
    $root.on('change', 'input[name="bagu-mode"]', function () { s.mode = this.value; save(); });
    $root.on('change', '.bagu-profile', function () { s.apiProfile = this.value; save(); });
    $root.on('change', '.bagu-opt', function () { s[this.dataset.key] = this.checked; save(); });
    $root.on('input', '.bagu-userwords', function () {
        s.userWords = this.value;
        save();
        for (const it of state.items) rescan(it);
    });
    $root.on('change', '.bagu-userwords', () => { if (state.items.length && !state.busy) renderList(); });

    $root.on('change', '.bagu-check', function () { const it = findItem(this); if (it) it.checked = this.checked; });
    $root.on('click', '.bagu-bulk a', function () {
        const mode = this.dataset.sel;
        for (const it of state.items) {
            it.checked = mode === 'all' ? true : mode === 'none' ? false
                : mode === 'hits' ? it.scan.total > 0 : it.status === 'ready';
        }
        renderList();
    });
    // details 的 toggle 事件不冒泡，用捕获阶段监听
    root.addEventListener('toggle', (ev) => {
        const el = ev.target;
        if (!el.classList?.contains('bagu-result')) return;
        const it = findItem(el);
        if (it) { if (el.open) state.open.add(it.id); else state.open.delete(it.id); }
    }, true);
    $root.on('click', '.bagu-revert', function () {
        const it = findItem(this);
        if (!it) return;
        it.after = null; it.status = 'idle'; it.warn = ''; it.left = [];
        state.open.delete(it.id);
        renderOne(it);
    });
    $root.on('click', '.bagu-redo', async function () {
        const it = findItem(this);
        if (!it || state.busy) return;
        await runItems([it]);
    });
    $root.on('input', '.bagu-editor', function () {
        const it = findItem(this);
        if (!it) return;
        it.after = this.value;
        it.status = it.after === it.before ? 'same' : 'ready';
        it.warn = protectStats(it.before, it.after);
        it.left = [...new Set(mustHits(it.after, ruleOpts()).map((h) => h.match))];
        $(this).siblings('.bagu-left').html(leftHtml(it));
    });
    $root.on('change', '.bagu-editor', function () {
        const it = findItem(this);
        if (it) $(this).siblings('.bagu-diffwrap').find('.bagu-diff').html(renderDiff(it.before, it.after));
    });
}

async function openCleaner() {
    const c = getCtx();
    const root = document.createElement('div');
    root.innerHTML = await popupHtml();
    state.root = root;
    state.items = [];
    state.open.clear();
    bindPopup(root);
    await c.callGenericPopup(root, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: '关闭' });
    state.abort = true;
    state.root = null;
}

// ───────────── 扩展设置面板 ─────────────

function settingsHtml() {
    const s = settings();
    const groups = Object.entries(RULE_GROUPS).map(([k, v]) =>
        `<label class="checkbox_label"><input type="checkbox" class="bagu-group" value="${k}" ${s.disabledGroups.includes(k) ? '' : 'checked'}>${v}</label>`).join('');
    const rules = DEFAULT_RULES.map((r) =>
        `<label class="checkbox_label"><input type="checkbox" class="bagu-rule" value="${r.id}" ${(s.ruleOverrides[r.id] ?? r.on) ? 'checked' : ''}><span>${esc(r.label)}</span><small class="bagu-dim">${RULE_GROUPS[r.group].split('（')[0]}</small></label>`).join('');
    return `
<div class="bagu-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>八股清理</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="menu_button bagu-open"><i class="fa-solid fa-broom"></i> 打开八股清理</div>
      <h4>规则分组</h4>
      ${groups}
      <details><summary>逐条开关（${DEFAULT_RULES.length} 条）</summary><div class="bagu-rulelist">${rules}</div></details>
      <h4>高级：自定义正则规则</h4>
      <small class="bagu-dim">普通八股词直接在面板里“我的八股词”加就行。这里是正则，每行一条：<br>
      删除: 正则<br>替换: 正则 =&gt; 替换文本<br>整句: 正则（分句基本只剩它时整句删）<br>标记: 正则（只标出来，交给 API 改）</small>
      <textarea class="text_pole bagu-custom" rows="5" placeholder="替换: 薄唇轻启 =&gt; 开口"></textarea>
      <h4>API 改写提示词</h4>
      <textarea class="text_pole bagu-prompt" rows="8"></textarea>
      <div class="menu_button bagu-prompt-reset">恢复默认提示词</div>
    </div>
  </div>
</div>`;
}

function bindSettings() {
    const s = settings();
    const $p = $('.bagu-settings');
    $p.find('.bagu-custom').val(s.customRules);
    $p.find('.bagu-prompt').val(s.aiPrompt);
    $p.on('click', '.bagu-open', openCleaner);
    $p.on('change', '.bagu-group', function () {
        const set = new Set(s.disabledGroups);
        if (this.checked) set.delete(this.value); else set.add(this.value);
        s.disabledGroups = [...set];
        save();
    });
    $p.on('change', '.bagu-rule', function () { s.ruleOverrides[this.value] = this.checked; save(); });
    $p.on('input', '.bagu-custom', function () { s.customRules = this.value; save(); });
    $p.on('input', '.bagu-prompt', function () { s.aiPrompt = this.value; save(); });
    $p.on('click', '.bagu-prompt-reset', () => { s.aiPrompt = DEFAULT_AI_PROMPT; $p.find('.bagu-prompt').val(s.aiPrompt); save(); });
}

jQuery(async () => {
    settings();
    $('#extensions_settings2').append(settingsHtml());
    bindSettings();
    const $menu = $('<div id="bagu_menu_button" class="list-group-item flex-container flexGap5 interactable" tabindex="0"><div class="fa-solid fa-broom extensionsMenuExtensionButton"></div>八股清理</div>');
    $menu.on('click', openCleaner);
    $('#extensionsMenu').append($menu);
});
