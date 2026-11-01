import {
    contextRowsToMap, buildContext, extractDecisionInfo, answeredPoints, flattenJson,
    diffResponses, escapeHtml, renderTemplate, templateData, previewDocument, previewDataUrl
} from '../simulatorUtils';

describe('request context', () => {
    it('turns rows into a map, skipping blank and reserved keys', () => {
        const { context, ignored } = contextRowsToMap([
            { key: ' productId ', value: 'SKU-1' },
            { key: '', value: 'x' },
            { key: 'individualId', value: 'nope' },
            { key: 'categories', value: '["a","b"]' },
            { key: 'bad', value: '{not json}' }
        ]);
        expect(context).toEqual({ productId: 'SKU-1', categories: ['a', 'b'], bad: '{not json}' });
        expect(ignored).toEqual(['individualId']);
    });

    it('builds the context with standard fields and custom rows', () => {
        const ctx = buildContext(
            { individualId: 'abc', dataspace: '', pageType: ' PDP ', requestTimeZone: 'UTC', requestUrl: '' },
            [{ key: 'productId', value: 'SKU-1' }, { key: 'pageType', value: 'Override' }]
        );
        expect(ctx).toEqual({
            individualId: 'abc', dataspace: 'default', pageType: 'Override',
            p13n_sys_requestTimeZone: 'UTC', productId: 'SKU-1'
        });
    });

    it('handles missing input', () => {
        expect(contextRowsToMap(undefined)).toEqual({ context: {}, ignored: [] });
        expect(buildContext(undefined, undefined)).toEqual({ individualId: undefined, dataspace: 'default' });
    });
});

describe('what answered', () => {
    const response = {
        requestId: 'r1',
        personalizations: [{
            personalizationId: 'p1',
            personalizationPointName: 'Hero',
            decisionId: 'd1',
            data: [{ decisionLabel: 'not this one' }],
            diagnostics: { experimentId: 'e1', cohortName: 'Variant B', empty: '', nested: { personalizerId: 'r9' } }
        }]
    };

    it('finds decision, experiment, cohort and personalizer fields outside data rows', () => {
        expect(extractDecisionInfo(response)).toEqual([
            { path: 'personalizations[0].decisionId', value: 'd1' },
            { path: 'personalizations[0].diagnostics.experimentId', value: 'e1' },
            { path: 'personalizations[0].diagnostics.cohortName', value: 'Variant B' },
            { path: 'personalizations[0].diagnostics.nested.personalizerId', value: 'r9' }
        ]);
        expect(extractDecisionInfo(null)).toEqual([]);
    });

    it('lists the points that answered', () => {
        expect(answeredPoints(response)).toEqual([{ name: 'Hero', personalizationId: 'p1' }]);
        expect(answeredPoints({})).toEqual([]);
    });
});

describe('compare', () => {
    it('flattens nested values', () => {
        expect(flattenJson({ a: { b: [1, { c: 'x' }] }, e: [], f: {}, g: null })).toEqual({
            'a.b[0]': '1', 'a.b[1].c': '"x"', e: '[]', f: '{}', g: 'null'
        });
        expect(flattenJson('text')).toEqual({ '(value)': '"text"' });
    });

    it('marks differences and ignores volatile IDs', () => {
        const a = JSON.stringify({ requestId: '1', personalizations: [{ personalizationId: 'x', data: [{ name: 'Shoe' }, { name: 'Hat' }] }] });
        const b = JSON.stringify({ requestId: '2', personalizations: [{ personalizationId: 'y', data: [{ name: 'Shoe' }] }] });
        const rows = diffResponses(a, b);
        const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
        expect(byPath.requestId).toMatchObject({ differs: false, volatile: true });
        expect(byPath['personalizations[0].data[0].name'].differs).toBe(false);
        expect(byPath['personalizations[0].data[1].name']).toMatchObject({ a: '"Hat"', b: '', differs: true });
    });

    it('copes with invalid JSON', () => {
        const rows = diffResponses('not json', null);
        expect(rows).toEqual([{ path: '(value)', a: '"not json"', b: 'null', differs: true, volatile: false }]);
    });
});

describe('template preview', () => {
    const data = {
        attributes: { header: 'Picked <for> you' },
        data: [{ name: 'Shoe', url: 'https://x/s', price: 10 }, { name: 'Hat', price: 0 }],
        flag: true
    };

    it('escapes variables and leaves triple braces raw', () => {
        expect(renderTemplate('<h1>{{attributes.header}}</h1>{{{attributes.header}}}', data))
            .toBe('<h1>Picked &lt;for&gt; you</h1>Picked <for> you');
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(`"'=\``)).toBe('&quot;&#39;&#61;&#96;');
    });

    it('supports each with index, first, last, this and parent lookups', () => {
        const tpl = '{{#each data}}{{@index}}:{{name}}{{#if price}}({{price}}){{else}}(free){{/if}}{{#unless @last}}, {{/unless}}{{/each}}';
        expect(renderTemplate(tpl, data)).toBe('0:Shoe(10), 1:Hat(free)');
        expect(renderTemplate('{{#each data}}{{../attributes.header}}|{{this.name}}{{/each}}', { ...data, attributes: { header: 'H' } }))
            .toBe('H|ShoeH|Hat');
        expect(renderTemplate('{{#each data}}{{#if @first}}first{{/if}}{{/each}}', data)).toBe('first');
    });

    it('supports with, else on each, objects in each and comments', () => {
        expect(renderTemplate('{{#with attributes}}{{header}}{{/with}}', { attributes: { header: 'H' } })).toBe('H');
        expect(renderTemplate('{{#with missing}}x{{else}}none{{/with}}', {})).toBe('none');
        expect(renderTemplate('{{#each items}}x{{else}}empty{{/each}}', { items: [] })).toBe('empty');
        expect(renderTemplate('{{#each o}}{{@key}}={{this}};{{/each}}', { o: { a: 1, b: 2 } })).toBe('a=1;b=2;');
        expect(renderTemplate('a{{! note }}b{{!-- long {{note}} --}}c', {})).toBe('abc');
        expect(renderTemplate('{{obj}}', { obj: { a: 1 } })).toBe('{&quot;a&quot;:1}');
        expect(renderTemplate('{{missing.deep}}', {})).toBe('');
        expect(renderTemplate('{{.}}', 'v')).toBe('v');
        expect(renderTemplate('', {})).toBe('');
    });

    it('reports unbalanced blocks and unknown helpers', () => {
        expect(() => renderTemplate('{{#if a}}x', {})).toThrow('Missing {{/if}}');
        expect(() => renderTemplate('x{{/if}}', {})).toThrow('Unexpected {{/if}}');
        expect(() => renderTemplate('{{#custom a}}x{{/custom}}', {})).toThrow('Unsupported helper');
    });

    it('builds the template data and a locked-down document', () => {
        const parsed = { requestId: 'r', personalizations: [{ data: [1], attributes: { a: 1 } }] };
        expect(templateData(parsed)).toEqual({ data: [1], attributes: { a: 1 }, personalizations: parsed.personalizations, requestId: 'r' });
        expect(templateData(null)).toEqual({ personalizations: [], requestId: null });
        const doc = previewDocument('<p>x</p>');
        expect(doc).toContain("default-src 'none'");
        expect(doc).toContain('<p>x</p>');
        expect(previewDataUrl('<p>a b</p>')).toBe('data:text/html;charset=utf-8,%3Cp%3Ea%20b%3C%2Fp%3E');
    });
});
