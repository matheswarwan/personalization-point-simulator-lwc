// Pure helpers for the simulator: request context, what answered a decision, compare,
// and a small Handlebars-style template renderer. No DOM, no Apex, so Jest covers them directly.

// ── Request context ─────────────────────────────────────────────

// Keys the component fills itself; a custom row with one of these names is ignored.
export const RESERVED_CONTEXT_KEYS = ['individualId', 'dataspace'];

/** A value that looks like JSON (object or array) is sent as JSON, anything else as text. */
function contextValue(raw) {
    const v = raw == null ? '' : String(raw);
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try { return JSON.parse(t); } catch { return v; }
    }
    return v;
}

/** `[{ key, value }]` rows to `{ context, ignored }`: blank keys skipped, reserved keys ignored. */
export function contextRowsToMap(rows) {
    const context = {};
    const ignored = [];
    for (const row of rows || []) {
        const key = (row?.key || '').trim();
        if (!key) continue;
        if (RESERVED_CONTEXT_KEYS.includes(key)) { ignored.push(key); continue; }
        context[key] = contextValue(row.value);
    }
    return { context, ignored };
}

/**
 * The request `context`: individual and data space, the standard fields that are filled,
 * then the custom rows (a custom row may override a standard field such as pageType).
 */
export function buildContext(fields, rows) {
    const f = fields || {};
    const context = { individualId: f.individualId, dataspace: f.dataspace || 'default' };
    const standard = [
        ['requestUrl', 'requestUrl'], ['pageType', 'pageType'], ['interaction', 'interaction'],
        ['channel', 'channel'], ['channelContext', 'channelContext'], ['requestTimeZone', 'p13n_sys_requestTimeZone']
    ];
    for (const [from, to] of standard) {
        const v = (f[from] || '').trim();
        if (v) context[to] = v;
    }
    return Object.assign(context, contextRowsToMap(rows).context);
}

// ── What answered ───────────────────────────────────────────────

const ANSWER_KEY = /decision|experiment|cohort|personalizer|variant|treatment|diagnostic/i;

/**
 * Fields in a decisioning response that say which decision, personalizer, experiment or
 * cohort answered: `[{ path, value }]`. The public endpoint returns few of these; the
 * authenticated one can add diagnostics. Content rows (`data`) are skipped.
 */
export function extractDecisionInfo(parsed) {
    const out = [];
    const walk = (node, path, depth) => {
        if (node == null || typeof node !== 'object' || depth > 5) return;
        for (const [key, value] of Object.entries(node)) {
            if (key === 'data') continue;
            const p = path ? `${path}.${key}` : key;
            if (ANSWER_KEY.test(key) && (value == null || typeof value !== 'object')) {
                if (value != null && value !== '') out.push({ path: p, value: String(value) });
            } else if (Array.isArray(value)) {
                value.forEach((v, i) => walk(v, `${p}[${i}]`, depth + 1));
            } else if (typeof value === 'object') {
                walk(value, p, depth + 1);
            }
        }
    };
    walk(parsed, '', 0);
    return out;
}

/** Points that answered: `[{ name, personalizationId }]` from `personalizations[]`. */
export function answeredPoints(parsed) {
    return ((parsed && parsed.personalizations) || []).map((p) => ({
        name: p.personalizationPointName || p.personalizationPointId || '',
        personalizationId: p.personalizationId || ''
    }));
}

// ── Compare ─────────────────────────────────────────────────────

/** Leaf values by path: `{ 'personalizations[0].data[1].name': 'Shoe' }`. */
export function flattenJson(value, prefix = '', out = {}) {
    if (value === null || typeof value !== 'object') {
        out[prefix || '(value)'] = value === undefined ? '' : JSON.stringify(value);
        return out;
    }
    const entries = Array.isArray(value) ? value.map((v, i) => [`[${i}]`, v]) : Object.entries(value);
    if (!entries.length) {
        out[prefix || '(value)'] = Array.isArray(value) ? '[]' : '{}';
        return out;
    }
    for (const [k, v] of entries) {
        const p = k.startsWith('[') ? `${prefix}${k}` : (prefix ? `${prefix}.${k}` : k);
        flattenJson(v, p, out);
    }
    return out;
}

// Paths that always differ between two calls and say nothing about the decision.
const VOLATILE = /(^|\.)(requestId|personalizationId|correlationId|timestamp|requestDateTime)$/i;

/**
 * Side-by-side rows for two response JSON strings: `[{ path, a, b, differs, volatile }]`.
 * IDs that change on every call are marked volatile and not counted as differences.
 */
export function diffResponses(jsonA, jsonB) {
    const parse = (s) => { try { return JSON.parse(s); } catch { return s == null ? null : String(s); } };
    const a = flattenJson(parse(jsonA));
    const b = flattenJson(parse(jsonB));
    const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return paths.map((path) => {
        const volatile = VOLATILE.test(path);
        const av = path in a ? a[path] : '';
        const bv = path in b ? b[path] : '';
        return { path, a: av, b: bv, differs: !volatile && av !== bv, volatile };
    });
}

// ── Template preview ────────────────────────────────────────────

export function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"'`=]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;'
    }[c]));
}

const TOKEN = /\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{(!--[\s\S]*?--|![^}]*|[^}]*?)\}\}/g;

function parseTemplate(tpl) {
    const root = { children: [] };
    const stack = [root];
    let last = 0;
    let m;
    const top = () => stack[stack.length - 1];
    const push = (node) => (top().inElse ? top().elseChildren : top().children).push(node);
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(tpl))) {
        if (m.index > last) push({ type: 'text', value: tpl.slice(last, m.index) });
        last = TOKEN.lastIndex;
        if (m[1] !== undefined) { push({ type: 'raw', path: m[1].trim() }); continue; }
        const body = m[2].trim();
        if (body.startsWith('!')) continue;
        if (body.startsWith('#')) {
            const [, name, arg = ''] = body.match(/^#(\w+)\s*(.*)$/) || [];
            const node = { type: 'block', name, arg: arg.trim(), children: [], elseChildren: [], inElse: false };
            push(node);
            stack.push(node);
        } else if (body.startsWith('/')) {
            const name = body.slice(1).trim();
            if (stack.length > 1 && top().name === name) stack.pop();
            else throw new Error(`Unexpected {{/${name}}}`);
        } else if (body === 'else') {
            if (stack.length > 1) top().inElse = true;
        } else if (body) {
            push({ type: 'var', path: body });
        }
    }
    if (last < tpl.length) push({ type: 'text', value: tpl.slice(last) });
    if (stack.length > 1) throw new Error(`Missing {{/${top().name}}}`);
    return root.children;
}

function resolve(path, frames) {
    let i = frames.length - 1;
    let p = path;
    while (p.startsWith('../')) { p = p.slice(3); i = Math.max(0, i - 1); }
    const frame = frames[i];
    if (p === 'this' || p === '.') return frame.value;
    if (p.startsWith('@')) return frame.meta ? frame.meta[p.slice(1)] : undefined;
    if (p.startsWith('this.')) p = p.slice(5);
    const parts = p.split('.');
    // Like Handlebars with compat on: look up the first segment in the nearest frame that has it.
    let start = i;
    while (start > 0 && !(frames[start].value && typeof frames[start].value === 'object' && parts[0] in frames[start].value)) start--;
    let v = frames[start].value;
    for (const part of parts) {
        if (v == null) return undefined;
        v = v[part];
    }
    return v;
}

const truthy = (v) => !(v == null || v === false || v === '' || v === 0 || (Array.isArray(v) && v.length === 0));

function renderNodes(nodes, frames) {
    let out = '';
    for (const n of nodes) {
        if (n.type === 'text') out += n.value;
        else if (n.type === 'var') out += escapeHtml(stringOf(resolve(n.path, frames)));
        else if (n.type === 'raw') out += stringOf(resolve(n.path, frames));
        else out += renderBlock(n, frames);
    }
    return out;
}

function stringOf(v) {
    if (v == null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function renderBlock(n, frames) {
    const v = resolve(n.arg, frames);
    if (n.name === 'if') return renderNodes(truthy(v) ? n.children : n.elseChildren, frames);
    if (n.name === 'unless') return renderNodes(!truthy(v) ? n.children : n.elseChildren, frames);
    if (n.name === 'with') return truthy(v) ? renderNodes(n.children, [...frames, { value: v }]) : renderNodes(n.elseChildren, frames);
    if (n.name === 'each') {
        const items = Array.isArray(v) ? v.map((x, i) => [i, x]) : (v && typeof v === 'object' ? Object.entries(v) : []);
        if (!items.length) return renderNodes(n.elseChildren, frames);
        return items.map(([key, item], index) => renderNodes(n.children, [...frames, {
            value: item,
            meta: { index, key, first: index === 0, last: index === items.length - 1 }
        }])).join('');
    }
    throw new Error(`Unsupported helper {{#${n.name}}}`);
}

/**
 * Renders a Handlebars-style template (variables, {{{raw}}}, #if/#unless/#each/#with, else,
 * @index/@key/@first/@last, ../, this). Helpers beyond those throw, so the preview can say so.
 */
export function renderTemplate(template, data) {
    return renderNodes(parseTemplate(String(template || '')), [{ value: data }]);
}

/**
 * The template's data: one personalization from the response (its `data` rows and
 * `attributes`), plus `personalizations` and `requestId` from the whole response.
 */
// ASSUMPTION: experience templates reference the personalization object (data, attributes).
export function templateData(parsed, index = 0) {
    const ps = (parsed && parsed.personalizations) || [];
    const p = ps[index] || {};
    return { ...p, personalizations: ps, requestId: parsed && parsed.requestId };
}

/** A full document for a sandboxed iframe: no scripts, no network except images. */
export function previewDocument(html) {
    return '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\'; font-src https: data:">'
        + '<style>body{font-family:system-ui,sans-serif;margin:8px}</style></head><body>'
        + html + '</body></html>';
}
