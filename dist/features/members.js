/**
 * 成员名录 —— 记录每个说过话的成员（openid + 名称历史）。
 *
 * 为什么需要：QQ 昵称随时会改，但 openid 在同一个机器人下稳定。
 * 归档里的消息行只带「短ID」（openid 前 8 位），换名字后靠短ID 仍能
 * 在这份名录里对应回同一个人。
 *
 * 产物：
 *   <archiveRoot>/members.md   —— 给人/模型看的名录（每次变更后重写）
 *   <archiveRoot>/members.json —— 内部状态（名称历史、首末次、次数）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { archiveRoot } from './archive-paths.js';
/** 短ID：openid 前 8 位，用于消息行与名录交叉定位 */
export function shortId(id) {
    const safe = String(id ?? '').replace(/[^0-9a-zA-Z]/g, '');
    return safe.slice(0, 8) || 'unknown';
}
function membersFile(config) {
    return join(archiveRoot(config), 'members.md');
}
function stateFile(config) {
    return join(archiveRoot(config), 'members.json');
}
/** 内存状态（按归档根目录隔离，支持多套配置） */
const states = new Map();
function emptyState() {
    return { version: 1, members: {} };
}
function loadState(config) {
    const key = archiveRoot(config);
    const cached = states.get(key);
    if (cached)
        return cached;
    let state = emptyState();
    try {
        const file = stateFile(config);
        if (existsSync(file)) {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            if (parsed && typeof parsed.members === 'object')
                state = parsed;
        }
    }
    catch {
        // 状态损坏就重建，不阻断归档
    }
    // 清理历史脏数据：短ID 被当成昵称写进去过（私聊没有昵称字段时的兜底）
    for (const [id, member] of Object.entries(state.members ?? {})) {
        if (Array.isArray(member.names)) {
            member.names = member.names.filter((name) => name && name !== shortId(id));
        }
    }
    states.set(key, state);
    return state;
}
function two(n) {
    return String(n).padStart(2, '0');
}
function fmt(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
function render(state) {
    const rows = Object.entries(state.members ?? {})
        .sort((a, b) => (b[1].lastSeen ?? 0) - (a[1].lastSeen ?? 0));
    const lines = [
        '# 成员名录',
        '',
        '> QQ 官方机器人只能拿到 openid（不是真实 QQ 号），同一机器人下 openid 固定不变。',
        '> 消息行里的短 ID 是 openid 前 8 位，换昵称后可用它对应回同一个人。',
        '',
        '| 短ID | openid | 当前名称 | 曾用名 | 首次出现 | 最近出现 | 次数 |',
        '|---|---|---|---|---|---|---|',
    ];
    for (const [id, m] of rows) {
        const names = Array.isArray(m.names) ? m.names : [];
        const current = names[names.length - 1] ?? '';
        const aliases = names.slice(0, -1).slice(-5).join('、');
        lines.push(`| ${shortId(id)} | ${id} | ${current} | ${aliases} | ${m.firstSeen ? fmt(m.firstSeen) : ''} | ${m.lastSeen ? fmt(m.lastSeen) : ''} | ${m.count ?? 0} |`);
    }
    if (rows.length === 0)
        lines.push('| （暂无记录） | | | | | | |');
    lines.push('');
    return lines.join('\n');
}
// ── 写入去抖：成员变更频繁时合并成一次全量重写 ──
const timers = new Map();
function scheduleFlush(config, logger) {
    const key = archiveRoot(config);
    if (timers.has(key))
        return;
    const timer = setTimeout(() => {
        timers.delete(key);
        flush(config, logger);
    }, 1500);
    timer.unref?.();
    timers.set(key, timer);
}
function flush(config, logger) {
    const state = loadState(config);
    try {
        const dir = dirname(membersFile(config));
        mkdirSync(dir, { recursive: true });
        writeFileSync(stateFile(config), JSON.stringify(state, null, 2), 'utf8');
        writeFileSync(membersFile(config), render(state), 'utf8');
    }
    catch (err) {
        logger?.warn?.(`im-qqbot: members write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * 记录一次发言（同名更新 lastSeen，改名追加到曾用名）。
 *
 * 同步更新内存，落盘去抖 1.5s；不抛异常。
 */
export function recordMember(config, info) {
    const id = String(info?.id ?? '').trim();
    if (!id)
        return;
    const state = loadState(config);
    const now = Date.now();
    const name = String(info.name ?? '').trim();
    const member = state.members[id] ?? { names: [], firstSeen: now, lastSeen: now, count: 0 };
    member.count = (member.count ?? 0) + 1;
    member.firstSeen = member.firstSeen ?? now;
    member.lastSeen = now;
    member.names = Array.isArray(member.names) ? member.names : [];
    // 私聊没有昵称字段，调用方可能拿短ID 兜底——那不是名字，不记
    if (name && name !== shortId(id) && member.names[member.names.length - 1] !== name) {
        // 保留最近 10 个名字，避免无限增长
        member.names = [...member.names, name].slice(-10);
    }
    if (info.scope)
        member.scope = String(info.scope);
    state.members[id] = member;
    scheduleFlush(config, info.logger);
}
/** 取某人的最近名称（没有记录返回 undefined） */
export function memberName(config, id) {
    const member = loadState(config).members?.[String(id ?? '')];
    const names = member?.names ?? [];
    const last = names[names.length - 1];
    return typeof last === 'string' && last.length > 0 ? last : undefined;
}
/** 查询名录：按名称/曾用名/openid 子串过滤，返回紧凑文本 */
export function membersSummary(config, options = {}) {
    const state = loadState(config);
    const query = String(options.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    const rows = Object.entries(state.members ?? {}).filter(([id, m]) => {
        if (!query)
            return true;
        if (String(id).toLowerCase().includes(query))
            return true;
        return (m.names ?? []).some((n) => String(n).toLowerCase().includes(query));
    });
    rows.sort((a, b) => (b[1].lastSeen ?? 0) - (a[1].lastSeen ?? 0));
    const total = rows.length;
    const lines = rows.slice(0, limit).map(([id, m]) => {
        const names = m.names ?? [];
        const current = names[names.length - 1] ?? '';
        const aliases = names.slice(0, -1).join('、');
        const aliasText = aliases ? `（曾用名：${aliases}）` : '';
        return `- ${shortId(id)} · ${current}${aliasText} · openid=${id} · 最近 ${m.lastSeen ? fmt(m.lastSeen) : '—'} · ${m.count ?? 0} 次`;
    });
    return {
        file: membersFile(config),
        total,
        text: lines.length > 0 ? lines.join('\n') : '（没有匹配的成员）',
    };
}
/** 立即落盘（退出/测试用） */
export function flushMembers(config, logger) {
    const key = archiveRoot(config);
    const timer = timers.get(key);
    if (timer) {
        clearTimeout(timer);
        timers.delete(key);
    }
    flush(config, logger);
}
//# sourceMappingURL=members.js.map
