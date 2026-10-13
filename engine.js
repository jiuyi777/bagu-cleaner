// 八股清理 · 规则引擎（不依赖 DOM，可在 Node 里单独测试）

const C = '\\u4e00-\\u9fff';
const IN = '[^，,；;。！？!?\\n]'; // 一个分句内部的字符

export const RULE_GROUPS = {
    punct: '标点堆叠（！！！/……………）',
    degree: '程度副词（极其/极为/极度）',
    measure: '量词修饰（一丝/一抹/一缕/一股）',
    modifier: '套路修饰语（若有若无/骨节分明/微不可察…）',
    body: '人体词汇（四肢百骸/头颅…）',
    clause: '套路短句（整句删除）',
    flagSyntax: '标记·套路句式（交给 AI）',
    flagImagery: '标记·套路意象（交给 AI）',
    must: '必改项（的弧度 + 我的八股词）',
    custom: '自定义规则',
};

const R = (id, group, type, re, extra = {}) => ({ id, group, type, re, on: true, ...extra });
const CL = (id, re, label) => R(id, 'clause', 'clause', re, { label });
const FL = (id, group, re, label) => R(id, group, 'flag', re, { label });

export const DEFAULT_RULES = [
    // ── 标点 ──
    R('p_bang', 'punct', 'replace', '([！？!?])\\1+', { to: '$1', label: '叠用！？' }),
    R('p_ellipsis', 'punct', 'replace', '…{3,}|\\.{4,}|。{3,}', { to: '……', label: '省略号堆叠' }),
    R('p_dash', 'punct', 'replace', '—{3,}', { to: '——', label: '破折号堆叠' }),
    R('p_comma', 'punct', 'replace', '[，,]{2,}', { to: '，', label: '逗号堆叠' }),
    R('p_dun', 'punct', 'replace', '、{2,}', { to: '、', label: '顿号堆叠' }),

    // ── 程度副词 ──
    R('d_ji', 'degree', 'replace', `(?:极其|极为|极度)(?=[${C}])`, { to: '', label: '极其/极为/极度' }),

    // ── 量词 ──
    R('m_yisi', 'measure', 'replace',
        `(?:一丝|一抹|一缕|一股)(?=(?:[${C}]{0,6}的)?(?:笑意|弧度|光亮|光线|气息|温度|热气|热意|暖意|凉意|寒意|冷意|颤抖|颤栗|战栗|酥麻|电流|血腥|腥甜|暗色|阴影|异样|迟疑|犹豫|情绪|念头|空气|涟漪|波澜|慌乱|不安|紧张|狡黠|玩味|戏谑|笑容|嘲讽|讥诮|无奈|疲惫|心疼|愧疚|失落|烦躁|怒意|杀意|冷意))`,
        { to: '', label: '一丝/一抹/一缕/一股' }),

    // ── 修饰语 ──
    R('mod_vague', 'modifier', 'replace',
        '(?:若有若无|似有若无|微不可察|几不可察|几不可查|不易察觉|难以察觉|几不可闻|微不可闻|细若蚊呐|细若蚊蝇|细如蚊呐|说不清道不明|意味不明|意味深长|不容置喙|不容置疑|不容抗拒)(?:的|地)',
        { to: '', label: '若有若无/微不可察…' }),
    R('mod_knuckle', 'modifier', 'replace', '骨节分明的(?=[手指])', { to: '', label: '骨节分明的' }),
    R('mod_callus', 'modifier', 'replace', '(?:带着|带有|覆着|覆有)(?:长年|常年)?(?:的)?(?:一层)?(?:薄茧|茧子)的(?=[指手])', { to: '', label: '带着薄茧的' }),
    R('mod_allofall', 'modifier', 'replace', '一切的一切', { to: '一切', label: '一切的一切' }),
    R('mod_cry', 'modifier', 'replace', '比哭还(?:要)?难看的(笑容|笑)', { to: '勉强的$1', label: '比哭还难看的笑' }),
    R('mod_sick', 'modifier', 'replace', '病态(?:的|地)', { to: '', label: '病态的', on: false }),
    R('mod_damn', 'modifier', 'replace', '该死的', { to: '', label: '该死的', on: false }),

    // ── 人体词汇 ──
    R('b_limbs', 'body', 'replace', '四肢百骸', { to: '全身', label: '四肢百骸' }),
    R('b_skull', 'body', 'replace', '头颅', { to: '头', label: '头颅' }),
    R('b_torso', 'body', 'replace', '躯体|身躯', { to: '身体', label: '躯体/身躯', on: false }),
    R('b_back', 'body', 'replace', '脊背|背脊', { to: '后背', label: '脊背/背脊', on: false }),

    // ── 整句删除（分句基本只剩套路时才删） ──
    CL('c_light', `光线(?:从${IN}{0,10})?斜切(?:进来|进屋|下来)`, '光线斜切进来'),
    CL('c_air', '(?:空气|气氛|周遭|四周|周围)(?:里|中)?(?:仿佛|似乎|像是|好像)?(?:在这一刻|瞬间|骤然|一下子)?(?:凝固|静止|冻结)(?:了)?', '空气凝固'),
    CL('c_time', '时间(?:仿佛|似乎|像是|好像)?(?:在这一刻|在此刻|在这一瞬)?(?:停滞|静止|凝固|停止)(?:了)?', '时间停滞'),
    CL('c_century', '(?:仿佛|像是|好像)(?:过了|度过了|熬过了)(?:整整)?一个世纪', '仿佛过了一个世纪'),
    CL('c_pause', '(?:像是|仿佛)被(?:人)?按(?:下)?了(?:暂停键|慢放键)', '按下暂停键'),
    CL('c_world', `(?:仿佛)?整个世界(?:都)?(?:屏住了呼吸|安静了下来|静止了|只剩下${IN}{1,8})`, '整个世界屏住呼吸'),
    CL('c_fate', `(?:命运|时光|宿命)的(?:齿轮|洪流|棋局|轨迹|獠牙)${IN}{0,14}`, '命运的齿轮'),
    CL('c_smirk', `(?:嘴角|唇角)(?:微微)?(?:勾起|扬起|噙着|挂着|浮起|牵起|微勾)(?:了)?(?:一抹|一丝|一个|一道)?(?:${IN}{0,8}的)?(?:弧度|笑意|笑)?`, '嘴角勾起弧度'),
    CL('c_eyes', '(?:眼神|眸色|眼底|眸光|眼眸)(?:微微)?(?:暗了暗|一暗|微沉|沉了沉|暗了下来|深了深)', '眼神暗了暗'),
    CL('c_heart', '(?:心脏|心跳|心)(?:猛地)?漏(?:跳)?了(?:半|一)拍', '心跳漏了一拍'),
    CL('c_breath', '呼吸(?:猛地)?(?:一滞|一窒|漏了一拍)', '呼吸一滞'),
    CL('c_adam', '喉结(?:上下)?滚动了?(?:一下|两下)?', '喉结滚动'),
    CL('c_blank', '大脑(?:一片)?空白(?:[，,](?:耳边|脑中)?嗡嗡作响)?', '大脑一片空白'),
    CL('c_begin', `(?:真正的${IN}{0,6}|一切|这一切|游戏|好戏)(?:才)?刚刚开始`, '才刚刚开始'),
    CL('c_changed', '有什么(?:东西)?(?:已经)?(?:彻底|悄然)?(?:改变|变了|不一样)(?:了)?', '有什么改变了'),
    CL('c_broken', '像是(?:有)?什么(?:东西)?(?:碎了|裂开了|被击中了)|像是被什么(?:东西)?(?:击中|击碎)了', '像是什么碎了'),
    CL('c_mixed', '(?:心中|心里|心头)?(?:五味杂陈|百感交集)', '五味杂陈'),
    CL('c_whateyes', `那是一(?:双|种|个)(?:怎样|什么样)的${IN}{1,8}啊`, '那是一双怎样的眼睛啊'),
    CL('c_deep', '深邃的(?:眼眸|眼睛|双眸)(?:像|如|宛如)一汪(?:深潭|幽潭)(?:[，,](?:又|也)?(?:像|如|宛如)(?:璀璨的)?(?:星辰|星空))?', '眼眸像深潭'),
    CL('c_ending', '事情就是这样|一切就是这样开始的|这就是当时发生的事|然后就没有然后了', '空洞收尾'),
    CL('c_mute', '张了张嘴(?:唇)?(?:[，,](?:却|但|最终)?(?:还是)?什么(?:也|都)没(?:能)?说(?:出口|出来)?)?', '张了张嘴却没说'),
    CL('c_wantsay', '似乎想(?:要)?说(?:些)?什么(?:[，,](?:但|却)?最终(?:还是)?(?:沉默了|什么也没说|没有开口))?', '似乎想说什么'),
    CL('c_tell', '仿佛在(?:诉说|述说|低语)着什么', '仿佛在诉说着什么'),

    // ── 必改：结果里不允许再出现 ──
    R('must_arc', 'must', 'flag', '的弧度', { label: '…的弧度', must: true }),

    // ── 标记：句式 ──
    FL('f_notbut', 'flagSyntax', `不是${IN}{1,16}[，,]?而是`, '不是……而是……'),
    FL('f_ratherthan', 'flagSyntax', `与其说${IN}{0,20}[，,]?不如说`, '与其说……不如说'),
    FL('f_notonly', 'flagSyntax', `非但${IN}{0,20}[，,]?反而|并非${IN}{0,16}[，,]?恰恰`, '非但……反而'),
    FL('f_close', 'flagSyntax', `近乎于${IN}{0,12}[，,]?又不(?:等同|同)于`, '近乎于……又不等同于'),
    FL('f_explain', 'flagSyntax', '也就是说|换句话说|这意味着', '解释性复述'),
    FL('f_because', 'flagSyntax', '(?:由于|鉴于)(?:某种|这层|方才)', '伪因果'),
    FL('f_between', 'flagSyntax', `介于${IN}{1,10}(?:和|与)${IN}{1,10}之间`, '介于……之间'),
    FL('f_omni', 'flagSyntax', `(?:他|她|它|他们|她们)(?:并)?不知道的是|在${IN}{0,8}看不见的(?:角落|地方)|若从(?:上方|高处)俯瞰`, '全知视角插入'),
    FL('f_mouth', 'flagSyntax', `嘴上说着${IN}{0,10}[，,]?(?:身体|眼神|心里)`, '嘴上说着……身体却'),
    FL('f_mind', 'flagSyntax', '理智(?:在)?(?:告诉|说)|身体比(?:意识|理智|大脑)更诚实', '理智/身体诚实'),

    // ── 标记：意象 ──
    FL('f_decimal', 'flagImagery', '\\d+\\.\\d+\\s*秒|\\d+(?:\\.\\d+)?\\s*度(?:角|的(?:弧|角))|(?:偏|侧|歪|仰|抬|低|转)了?\\s*\\d+\\s*度', '伪精确数字'),
    FL('f_anat', 'flagImagery', '肱二头肌|股骨|腓肠肌|掌指关节|胸锁乳突肌|尾椎骨|髋骨|胯骨', '解剖学词汇'),
    FL('f_hunt', 'flagImagery', '猎人|猎物|捕食者|笼中雀|执棋者|收网|围猎|无处可逃|困兽', '猎人与猎物'),
    FL('f_stone', 'flagImagery', '(?:石子|石头)(?:投|落|砸)(?:入|进)?(?:湖|水)|涟漪(?:层层)?(?:扩散|荡开)', '石子投湖'),
    FL('f_scalpel', 'flagImagery', '手术刀般|如同手术刀|收藏家(?:审视|打量)|如同艺术品|像(?:一件)?艺术品|提线木偶|精美的人偶|精密仪器', '手术刀/艺术品/木偶'),
    FL('f_spine', 'flagImagery', '(?:从|顺着)尾椎(?:骨)?|天灵盖|电流(?:般)?(?:窜|划)过|过电(?:般|一样)|头皮发麻', '尾椎窜上电流'),
    FL('f_possess', 'flagImagery', '占有欲|刻在骨子里|近乎(?:于)?条件反射|揉(?:进|入)骨血', '占有欲/刻在骨子里'),
    FL('f_pupil', 'flagImagery', '瞳孔(?:骤然|猛地|微微)?(?:一缩|骤缩|猛缩|缩了缩|紧缩)', '瞳孔骤缩'),
    FL('f_white', 'flagImagery', `(?:指节|骨节)${IN}{0,4}(?:泛白|发白|泛青)`, '指节泛白'),
    FL('f_holy', 'flagImagery', '宛若神明|虔诚的信徒|献祭|圣物|神圣的仪式', '宗教史诗比喻'),
    FL('f_animal', 'flagImagery', '像(?:一只)?(?:受惊|炸毛|被踩(?:到|了)尾巴|被顺毛|慵懒|温顺)的(?:猫|小猫|小鹿|幼兽|兔子|野兔)', '动物比喻'),
    FL('f_throat', 'flagImagery', '(?:喉咙|喉间)(?:里)?(?:溢出|泄出|挤出)', '喉间溢出'),
    FL('f_ant', 'flagImagery', '看(?:待)?蝼蚁|居高临下的审视|古井无波', '蝼蚁/古井无波'),
    FL('f_cold', 'flagImagery', '如坠冰窟|淬(?:了|着)?(?:冰|毒)', '淬了冰'),
];

export const LEGACY_AI_PROMPT = `你是中文小说编辑，负责给 AI 角色扮演用的角色卡、世界书、开场白去“八股”。

八股指 AI 写作的套路化表达，例如：程度副词堆叠（极其/极为/极度）、量词修饰（一丝/一抹/一缕）、若有若无的弧度、骨节分明的手指、眼神暗了暗、空气凝固、时间停滞、命运的齿轮、猎人与猎物、石子投湖、手术刀般精准、“不是……而是……”“与其说……不如说……”这类伪深刻转折、伪精确数字（0.3秒、15度）、硬塞的解剖学词汇、全知视角插入、不必要的动物比喻、空洞的升华式结尾。

改写要求：
1. 保留全部设定信息：人名、地名、关系、外貌事实、能力、规则、时间线、数值。不增不减。
2. 原样保留 {{char}}、{{user}} 等宏，尖括号标签，代码块，Markdown 结构和换行。
3. 用具体、平实的描写代替套路；能删就删，不要换成另一套华丽辞藻。
4. 对白尽量保留原意和语气，只修掉明显的套路词。
5. 篇幅与原文接近或更短。
6. 【必须改掉】里列出的词句，结果里一个都不能再出现（包括对白里），换成具体描写或直接删去。
7. 只输出改写后的正文，不要解释，不要加标题，不要用代码块或引号包住全文。`;

// 所有 API 模式均执行此编辑约束，包括用户保存过的自定义提示词。
export const PREVIOUS_EDIT_CONTRACT = `【局部编辑约束】
逐段保留原文的人物、动作、对白、场景细节、情绪变化、事件顺序和设定信息，只调整命中的词句及其必要衔接。
可直接删除不承载信息的赘词、重复修饰；承载信息的词句改成自然表达，保留原意和语气。未命中的内容尽量原样保留。
必改词是措辞修改目标。遇到宽泛规则或改写后仍命中时，优先保全内容，留下待人工处理的词句。
逐段输出完整修改稿，正文长度通常保持原文的 90%～110%，至少保留 80%；靠保留细节达到篇幅，保持原有剧情。
原样保留宏、标签、代码块、链接及 Markdown 结构。只输出修改后的全文。`;

export const PREVIOUS_AI_PROMPT = `你是中文小说编辑，负责调整角色卡、世界书和开场白中的套路化表达。

${PREVIOUS_EDIT_CONTRACT}`;

// v1.2.2 的片段级约束，只用于识别旧设置并迁移
export const V4_EDIT_CONTRACT = `【局部替换约束】
根据上下文修改指定片段，保留片段表达的动作、情绪、人物关系、事实和语气。冗余修饰可精简，承载信息的内容换成自然表达。
未指定的内容由程序原样保留。上下文供理解使用，输出范围仅限指定片段。
短语可以自然缩短，例如“嘴角勾起一抹若有若无的弧度”可写成“轻轻笑了笑”。长句保留原有事件和细节。
每个片段按本次请求指定的格式输出替换文字，宏、标签、代码块和链接由程序保护。`;

export const V4_AI_PROMPT = `你是中文小说编辑，负责调整角色卡、世界书和开场白中的套路化表达。\n\n${V4_EDIT_CONTRACT}`;

// 所有 API 模式都附加这段整句修改约束，包括用户自定义的提示词。
export const EDIT_CONTRACT = `【整句修改约束】
程序只把含八股的句子交给你，每句给出命中的八股和前后句。其他句子由程序原样保留。
逐句处理：能删掉的套路词直接删；删了不通顺或丢了内容的，把这句改写成自然的说法。
保留这句原有的动作、对白内容、事实和语气，不加新情节。长短不限，按改好为准。
整句只是空套路、删掉不影响内容的，可以输出空字符串。
句子里的 {{char}}、{{user}} 等宏原样保留。`;

export const DEFAULT_AI_PROMPT = `你是中文小说编辑，负责修改角色卡、世界书和开场白里的 AI 八股句子。\n\n${EDIT_CONTRACT}`;

export function rewriteIssue(before, after) {
    const count = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s/g, '').length;
    const oldSize = count(before);
    const newSize = count(after);
    if (oldSize && newSize < Math.ceil(oldSize * 0.8)) {
        return `正文从 ${oldSize} 字缩为 ${newSize} 字，低于原文的 80%`;
    }
    if (!String(after ?? '').trim() && String(before ?? '').trim()) return '结果为空';
    return '';
}

// ───────────── 规则编译 ─────────────

export function parseCustomRules(src, errors = []) {
    const out = [];
    let n = 0;
    for (const raw of String(src || '').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^(删除|替换|整句|标记)\s*[:：]\s*(.+)$/);
        if (!m) { errors.push(`无法识别：${line}`); continue; }
        n++;
        let re = m[2];
        let to = '';
        if (m[1] === '替换') {
            const k = re.lastIndexOf('=>');
            if (k < 0) { errors.push(`替换规则缺少 =>：${line}`); continue; }
            to = re.slice(k + 2).trim();
            re = re.slice(0, k).trim();
        }
        const type = { 删除: 'replace', 替换: 'replace', 整句: 'clause', 标记: 'flag' }[m[1]];
        out.push({ id: `custom_${n}`, group: 'custom', type, re, to, label: `自定义:${re.slice(0, 10)}`, on: true });
    }
    return out;
}

function compile(r, errors) {
    try {
        return { ...r, rx: new RegExp(r.re, r.type === 'clause' ? '' : 'g') };
    } catch (e) {
        errors.push(`正则无效（${r.label}）：${e.message}`);
        return null;
    }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 用户的八股词：每行一个，普通文字；以 re: 开头则按正则处理。全部视为必改。 */
export function parseUserWords(src) {
    const out = [];
    let n = 0;
    for (const raw of String(src || '').split('\n')) {
        const w = raw.trim();
        if (!w || w.startsWith('#')) continue;
        n++;
        const isRe = /^re[:：]/i.test(w);
        const body = isRe ? w.replace(/^re[:：]\s*/i, '') : w;
        out.push({ id: `user_${n}`, group: 'must', type: 'flag', must: true, re: isRe ? body : escapeRe(body), label: body.slice(0, 16), on: true });
    }
    return out;
}

export function buildRules({ ruleOverrides = {}, disabledGroups = [], customRules = '', userWords = '' } = {}) {
    const errors = [];
    const list = [];
    for (const r of DEFAULT_RULES) {
        const on = ruleOverrides[r.id] ?? r.on;
        if (!on || disabledGroups.includes(r.group)) continue;
        list.push(compile(r, errors));
    }
    if (!disabledGroups.includes('must')) {
        for (const r of parseUserWords(userWords)) list.push(compile(r, errors));
    }
    if (!disabledGroups.includes('custom')) {
        for (const r of parseCustomRules(customRules, errors)) list.push(compile(r, errors));
    }
    return { rules: list.filter(Boolean), errors };
}

// ───────────── 保护区：宏、标签、代码块、链接、（可选）引号对白 ─────────────

const PROTECT_BASE = [
    /```[\s\S]*?```/g,
    /\{\{[\s\S]*?\}\}/g,
    /<[^<>\n]{1,300}>/g,
    /https?:\/\/[^\s]+/g,
    /\[[^[\]\n]{0,80}\]\([^)\n]*\)/g,
];
const PROTECT_QUOTES = [/“[^“”]*”/g, /「[^「」]*」/g, /『[^『』]*』/g, /"[^"\n]*"/g];
const PH = /[\uE100-\uF8FF]/g;

/** 返回真实原文范围，保护区与检测、修改共用。 */
export function protectedRanges(text, quotes = false) {
    const spans = [];
    for (const rx of [...PROTECT_BASE, ...(quotes ? PROTECT_QUOTES : [])]) {
        for (const m of text.matchAll(new RegExp(rx.source, 'g'))) {
            spans.push({ start: m.index, end: m.index + m[0].length });
        }
    }
    return spans;
}

const MACRO_RX = /\{\{[\s\S]*?\}\}/g;
const HARD_BASE = PROTECT_BASE.filter((rx) => rx.source !== MACRO_RX.source);
const SENTENCE_RX = /[^。！？!?…\n]+(?:[。！？!?…]+[”」』"’）)]*)?|[。！？!?…]+[”」』"’）)]*/g;

function rangesOf(text, list) {
    const out = [];
    for (const rx of list) {
        for (const m of text.matchAll(new RegExp(rx.source, 'g'))) out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out.sort((a, b) => a.start - b.start);
}
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

/** 按句切分。标签、代码块、链接单独隔开，不并进句子；宏留在句子里。 */
export function splitSentences(text) {
    const hard = rangesOf(text, HARD_BASE);
    const out = [];
    const take = (from, to) => {
        const part = text.slice(from, to);
        for (const m of part.matchAll(SENTENCE_RX)) {
            const lead = m[0].match(/^\s*/)[0].length;
            const value = m[0].slice(lead).replace(/\s+$/, '');
            if (!value) continue;
            const start = from + m.index + lead;
            out.push({ start, end: start + value.length });
        }
    };
    let pos = 0;
    for (const h of hard) {
        if (h.start > pos) take(pos, h.start);
        pos = Math.max(pos, h.end);
    }
    take(pos, text.length);
    return out;
}

/**
 * 编辑目标：含八股的整句。all=true 时每句都是目标。
 * 每个目标带命中的八股（hits）和前后句，供 API 理解。
 */
export function editTargets(text, { rules = [], protectQuotes = true } = {}, all = false) {
    const sentences = splitSentences(text);
    const hard = rangesOf(text, PROTECT_BASE);
    const quotes = protectQuotes ? rangesOf(text, PROTECT_QUOTES) : [];
    const hitsBy = sentences.map(() => new Map());
    for (const r of rules) {
        let rx;
        try { rx = new RegExp(r.re, 'g'); } catch { continue; }
        for (const m of text.matchAll(rx)) {
            if (!m[0]) continue;
            const span = { start: m.index, end: m.index + m[0].length };
            if (hard.some((p) => overlaps(span, p))) continue;
            if (!r.must && quotes.some((p) => overlaps(span, p))) continue;
            sentences.forEach((s, i) => { if (overlaps(span, s)) hitsBy[i].set(`${r.label}|${m[0]}`, { label: r.label, match: m[0] }); });
        }
    }
    const targets = [];
    sentences.forEach((s, i) => {
        if (!all && !hitsBy[i].size) return;
        const prev = sentences[i - 1];
        const next = sentences[i + 1];
        targets.push({
            ...s,
            id: `s${targets.length + 1}`,
            text: text.slice(s.start, s.end),
            hits: [...hitsBy[i].values()],
            prev: prev ? text.slice(prev.start, prev.end) : '',
            next: next ? text.slice(next.start, next.end) : '',
        });
    });
    return targets;
}

/** 只检查格式：宏不能丢或多，不能凭空出现标签/代码。长短不限，允许删成空。 */
export function editIssue(target, replacement) {
    if (typeof replacement !== 'string') return '缺少修改结果';
    const macros = (s) => (s.match(MACRO_RX) || []).sort().join('');
    if (macros(target.text) !== macros(replacement)) return '宏（{{char}} 等）要原样保留';
    if (rangesOf(replacement, HARD_BASE).length) return '结果里多了标签、代码或链接';
    return '';
}

export function applyEdits(text, targets, replacements) {
    let result = '';
    let offset = 0;
    for (const t of targets) {
        const next = replacements.get(t.id);
        result += text.slice(offset, t.start) + (typeof next === 'string' ? next : t.text);
        offset = t.end;
    }
    return result + text.slice(offset);
}

export function parseEdits(raw) {
    const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(text);
    const edits = Array.isArray(data) ? data : data?.edits;
    if (!Array.isArray(edits)) throw new Error('需要 edits 数组');
    const map = new Map();
    const duplicates = new Set();
    for (const e of edits) {
        if (typeof e?.id !== 'string') continue;
        if (duplicates.has(e.id)) continue;
        if (map.has(e.id)) { map.delete(e.id); duplicates.add(e.id); continue; }
        if (typeof e.text !== 'string') continue;
        map.set(e.id, e.text);
    }
    return map;
}

function protect(text, quotes) {
    const store = [];
    let out = text;
    for (const re of [...PROTECT_BASE, ...(quotes ? PROTECT_QUOTES : [])]) {
        out = out.replace(re, (m) => {
            if (store.length >= 6000) return m;
            store.push(m);
            return String.fromCharCode(0xE100 + store.length - 1);
        });
    }
    const restore = (s) => {
        for (let i = 0; i < 4 && PH.test(s); i++) {
            PH.lastIndex = 0;
            s = s.replace(PH, (ch) => store[ch.charCodeAt(0) - 0xE100] ?? ch);
        }
        PH.lastIndex = 0;
        return s;
    };
    return { out, restore };
}

// ───────────── 整句删除 ─────────────

const SPLIT = /([，,；;。！？!?\n]+)/;
const COMMA_ONLY = /^[，,；;]+$/;
const PRONOUN = /^(?:他们|她们|我们|你们|它们|他|她|它|我|你|对方)/;
const FILLER = /微微|轻轻|缓缓|随即|不禁|不由得|一时间|此刻|那一刻|在这一刻|整个人|忽然|突然|顿时|瞬间|仿佛|似乎|像是|好像|一下|再次|只是|便|就|也|又|了|的|地|却|但|而|那|这/g;
const BLOCK = /[“”「」『』"《》()（）[\]【】\uE100-\uF8FF]/;

function evalMatch(t, m) {
    const before = t.slice(0, m.index).trim();
    const after = t.slice(m.index + m[0].length);
    const subj = (before.match(PRONOUN) || [''])[0];
    const rest = before.slice(subj.length) + after;
    if (BLOCK.test(rest)) return { ok: false };
    const left = rest.replace(FILLER, '').replace(/\s+/g, '');
    return { ok: left.length <= 4, subject: subj };
}

function mergeEnd(prevD, d) {
    const nlP = prevD.replace(/[^\n]/g, '');
    if (nlP) return prevD; // 前一句已经换行收尾，不需要补标点
    const nlD = d.replace(/[^\n]/g, '');
    const pP = prevD.replace(/\n/g, '');
    const pD = d.replace(/\n/g, '');
    let punct;
    if (pP === '') punct = pD;
    else if (COMMA_ONLY.test(pP)) punct = pD || '。';
    else punct = pP;
    return punct + (nlP.length >= nlD.length ? nlP : nlD);
}

function applyClauses(text, rules, hits) {
    const clauseRules = rules.filter((r) => r.type === 'clause');
    if (!clauseRules.length) return text;
    const parts = text.split(SPLIT);
    const toks = [];
    for (let i = 0; i < parts.length; i += 2) toks.push({ t: parts[i], d: parts[i + 1] ?? '' });

    const out = [];
    let carry = '';
    let indent = '';
    for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        let del = null;
        for (const rule of clauseRules) {
            if (i + 1 < toks.length && COMMA_ONLY.test(tok.d)) {
                const joined = tok.t + tok.d + toks[i + 1].t;
                const m = rule.rx.exec(joined);
                if (m && m[0] && m.index < tok.t.length && m.index + m[0].length > tok.t.length + tok.d.length) {
                    const r = evalMatch(joined, m);
                    if (r.ok) { del = { span: 2, rule, match: m[0], subject: r.subject }; break; }
                }
            }
            const m = rule.rx.exec(tok.t);
            if (m && m[0]) {
                const r = evalMatch(tok.t, m);
                if (r.ok) { del = { span: 1, rule, match: m[0], subject: r.subject }; break; }
            }
        }

        if (del) {
            hits.push({ id: del.rule.id, label: del.rule.label, type: 'clause', match: del.match });
            const lead = tok.t.match(/^[\s\u3000]*/)[0];
            if (lead && (!out.length || out[out.length - 1].d.includes('\n'))) indent = lead;
            const last = toks[i + del.span - 1];
            if (COMMA_ONLY.test(last.d) && i + del.span < toks.length) {
                carry = del.subject || carry;
            } else {
                carry = '';
                if (out.length) out[out.length - 1].d = mergeEnd(out[out.length - 1].d, last.d);
            }
            i += del.span - 1;
            continue;
        }

        let t = tok.t;
        if (indent) { t = indent + t.replace(/^[\s\u3000]*/, ''); indent = ''; }
        if (carry) {
            const lead = t.match(/^[\s\u3000]*/)[0];
            const body = t.slice(lead.length);
            if (body && !PRONOUN.test(body)) t = lead + carry + body;
            carry = '';
        }
        out.push({ t, d: tok.d });
    }
    return out.map((x) => x.t + x.d).join('');
}

function tidy(text) {
    return text
        .replace(/(^|\n)([ \t\u3000]*)[，,；;]+/g, '$1$2')
        .replace(/[，,；;]+([。！？!?])/g, '$1')
        .replace(/([。！？!?])[，,；;]+/g, '$1')
        .replace(/^\n+/, (m) => m); // 保留原样开头
}

// ───────────── 对外接口 ─────────────

/** 规则清理：返回 { text, hits } */
export function cleanText(text, { rules = [], protectQuotes = true } = {}) {
    if (!text) return { text: text ?? '', hits: [] };
    const hits = [];
    const p = protect(text, protectQuotes);
    let s = applyClauses(p.out, rules, hits);
    for (const r of rules) {
        if (r.type !== 'replace') continue;
        r.rx.lastIndex = 0;
        const ms = s.match(r.rx);
        if (!ms) continue;
        for (const m of ms) hits.push({ id: r.id, label: r.label, type: 'replace', match: m });
        r.rx.lastIndex = 0;
        s = s.replace(r.rx, r.to ?? '');
    }
    s = tidy(s);
    // 整段都被当成套路删光时保留原文，交给 API 处理
    if (!s.trim()) return { text, hits };
    return { text: p.restore(s), hits };
}

function flagHits(text, rules, protectQuotes) {
    const p = protect(text, protectQuotes);
    const hits = [];
    for (const r of rules) {
        if (r.type !== 'flag') continue;
        // 必改项连引号里的对白也查
        const src = r.must ? text : p.out;
        const blocked = r.must ? protectedRanges(text) : [];
        r.rx.lastIndex = 0;
        for (const m of src.matchAll(r.rx)) {
            if (!m[0]) continue;
            if (blocked.some(p => m.index < p.end && m.index + m[0].length > p.start)) continue;
            const s = r.must ? m[0] : p.restore(m[0]);
            const ctx = r.must ? text.slice(Math.max(0, m.index - 8), m.index + m[0].length + 2) : s;
            hits.push({ id: r.id, label: r.label, type: r.must ? 'must' : 'flag', match: s, context: ctx });
        }
    }
    return hits;
}

/** 必改项命中（结果里不允许再出现的） */
export function mustHits(text, opts = {}) {
    return flagHits(text || '', (opts.rules || []).filter((r) => r.must), false);
}

/** 列出具体命中片段，给 AI 当提示 */
export function hitList(text, opts = {}) {
    const { rules = [], protectQuotes = true } = opts;
    const auto = cleanText(text, { rules, protectQuotes }).hits;
    const flags = flagHits(text || '', rules, protectQuotes);
    return [...auto, ...flags];
}

export function flagCount(text, opts = {}) {
    return flagHits(text || '', opts.rules || [], opts.protectQuotes ?? true).length;
}

/** 扫描：返回命中统计，不修改文本 */
export function scanText(text, opts = {}) {
    const { rules = [], protectQuotes = true } = opts;
    const auto = cleanText(text, { rules, protectQuotes }).hits;
    const flags = flagHits(text || '', rules, protectQuotes);
    const map = new Map();
    for (const h of [...auto, ...flags]) {
        const k = h.label;
        const v = map.get(k) || { label: k, count: 0, type: h.type === 'flag' || h.type === 'must' ? h.type : 'auto' };
        v.count++;
        map.set(k, v);
    }
    const order = { must: 0, flag: 1, auto: 2 };
    const top = [...map.values()].sort((a, b) => order[a.type] - order[b.type] || b.count - a.count);
    const len = Math.max(1, (text || '').length);
    const must = flags.filter((h) => h.type === 'must').length;
    return { auto: auto.length, flag: flags.length - must, must, total: auto.length + flags.length, density: ((auto.length + flags.length) * 1000) / len, top };
}

/** 识别“规则/提示词”型条目（例如本身就是一张禁用词清单），默认跳过以免清单被清空 */
export function looksLikeInstructions(text) {
    const s = text || '';
    const quoted = (s.match(/[“"「][^“”"「」\n]{1,30}[”"」]/g) || []).length;
    const directives = (s.match(/禁止|禁用|不要使用|避免使用|不得|严禁|强制|必须|【[^】\n]{1,12}】/g) || []).length;
    return (quoted >= 10 && directives >= 2) || directives >= 8;
}

/** 检查宏/标签数量是否被改动 */
export function protectStats(before, after) {
    const count = (s, re) => (s.match(re) || []).length;
    const warns = [];
    const pairs = [[/\{\{[^}]*\}\}/g, '{{宏}}'], [/<[^<>\n]{1,300}>/g, '<标签>'], [/```/g, '代码块']];
    for (const [re, name] of pairs) {
        const a = count(before, re);
        const b = count(after, re);
        if (a !== b) warns.push(`${name} 数量 ${a}→${b}`);
    }
    return warns.length ? `⚠ ${warns.join('，')}，请检查` : '';
}

/** 按段落切块，供 AI 分段改写 */
export function splitChunks(text, max = 1800) {
    const parts = String(text).split(/(\n+)/);
    const chunks = [];
    let cur = '';
    let has = false;
    for (let i = 0; i < parts.length; i += 2) {
        const p = parts[i];
        const sep = parts[i + 1] ?? '';
        if (has && cur.length + p.length > max) { chunks.push(cur); cur = ''; }
        cur += p + sep;
        has = true;
    }
    if (cur) chunks.push(cur);
    return chunks;
}

// ───────────── 分句级 diff ─────────────

function tokenize(s) {
    return s.match(/[^，,；;。！？!?\n]*[，,；;。！？!?\n]+|[^，,；;。！？!?\n]+$/g) || [];
}

export function diffText(a, b) {
    const A = tokenize(a);
    const B = tokenize(b);
    const n = A.length;
    const m = B.length;
    if (n * m > 2_500_000) return [{ type: 'del', text: a }, { type: 'add', text: b }];
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    const push = (type, text) => {
        const last = ops[ops.length - 1];
        if (last && last.type === type) last.text += text; else ops.push({ type, text });
    };
    while (i < n && j < m) {
        if (A[i] === B[j]) { push('eq', A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i++]); } else { push('add', B[j++]); }
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('add', B[j++]);

    // 相邻的 删+增 细化为字符级（只裁掉公共前后缀）
    const out = [];
    for (let k = 0; k < ops.length; k++) {
        const o = ops[k];
        const nx = ops[k + 1];
        if (o.type === 'del' && nx && nx.type === 'add') {
            const x = o.text;
            const y = nx.text;
            let p = 0;
            while (p < x.length && p < y.length && x[p] === y[p]) p++;
            let q = 0;
            while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
            if (p) out.push({ type: 'eq', text: x.slice(0, p) });
            if (x.length - p - q > 0) out.push({ type: 'del', text: x.slice(p, x.length - q) });
            if (y.length - p - q > 0) out.push({ type: 'add', text: y.slice(p, y.length - q) });
            if (q) out.push({ type: 'eq', text: x.slice(x.length - q) });
            k++;
        } else {
            out.push(o);
        }
    }
    return out;
}
