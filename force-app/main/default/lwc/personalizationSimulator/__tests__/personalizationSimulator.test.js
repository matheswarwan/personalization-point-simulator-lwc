import { createElement } from 'lwc';
import PersonalizationSimulator from 'c/personalizationSimulator';
import getConfig from '@salesforce/apex/PersonalizationSimulatorController.getConfig';
import getPointInfo from '@salesforce/apex/PersonalizationSimulatorController.getPointInfo';
import getPersonalizationPointApiName from '@salesforce/apex/PersonalizationSimulatorController.getPersonalizationPointApiName';
import getRecentDeviceIds from '@salesforce/apex/PersonalizationSimulatorController.getRecentDeviceIds';
import runDecision from '@salesforce/apex/PersonalizationSimulatorController.runDecision';
import lookupDecisionLog from '@salesforce/apex/PersonalizationSimulatorController.lookupDecisionLog';
import getDataGraphValues from '@salesforce/apex/PersonalizationSimulatorController.getDataGraphValues';

jest.mock('@salesforce/apex/PersonalizationSimulatorController.getConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonalizationSimulatorController.getPointInfo', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonalizationSimulatorController.getPersonalizationPointApiName', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonalizationSimulatorController.getRecentDeviceIds', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonalizationSimulatorController.runDecision', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonalizationSimulatorController.lookupDecisionLog', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PersonalizationSimulatorController.getDataGraphValues', () => ({ default: jest.fn() }), { virtual: true });

const RESPONSE = (name) => JSON.stringify({
    requestId: 'req-' + name,
    personalizations: [{
        personalizationId: 'p-' + name,
        personalizationPointName: 'Home_Hero',
        decisionId: 'dec-1',
        attributes: { header: 'Hello' },
        data: [{ personalizationContentId: 'c1', name }]
    }]
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount({ pointInfo = { apiName: 'Home_Hero', requiresAuth: true }, pointInfoError = false } = {}) {
    getConfig.mockResolvedValue({ tseBaseUrl: 'https://tenant.example', dataspace: 'default', orgBaseUrl: '' });
    if (pointInfoError) getPointInfo.mockRejectedValue({ body: { message: 'no field' } });
    else getPointInfo.mockResolvedValue(pointInfo);
    getPersonalizationPointApiName.mockResolvedValue('Fallback_Name');
    getRecentDeviceIds.mockResolvedValue([]);
    const el = createElement('c-personalization-simulator', { is: PersonalizationSimulator });
    el.recordId = '9ppAA0000000001AAA';
    document.body.appendChild(el);
    await flush();
    return el;
}

const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const button = (el, label) => $$(el, 'lightning-button').find((b) => b.label === label);

function typeInto(input, value) {
    input.value = value;
    input.dispatchEvent(new CustomEvent('change'));
}

describe('c-personalization-simulator', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('shows the point authentication setting and falls back to the name on error', async () => {
        let el = await mount();
        expect($(el, '[data-id="requires-auth"]').textContent).toBe('Point requires authentication: yes');
        document.body.removeChild(el);

        el = await mount({ pointInfoError: true });
        expect(getPersonalizationPointApiName).toHaveBeenCalled();
        expect($(el, '[data-id="requires-auth"]').textContent).toBe('Point authentication setting: unknown');
    });

    it('sends custom context keys and the auth mode, and shows the mode used', async () => {
        runDecision.mockResolvedValue({
            success: true, httpStatus: 200, responseJson: RESPONSE('Shoe'),
            mode: 'Authenticated', modeDetail: 'Point requires authentication. Invocable action getPersonalizationDecisions.', notes: []
        });
        const el = await mount();
        button(el, 'Add key').click();
        await flush();
        const [keyInput, valueInput] = $$(el, '.context-row lightning-input');
        typeInto(keyInput, 'productId');
        typeInto(valueInput, 'SKU-1');
        await flush();

        button(el, 'Simulate').click();
        await flush();
        await flush();

        expect(runDecision).toHaveBeenCalledTimes(1);
        const req = JSON.parse(runDecision.mock.calls[0][0].requestJson);
        expect(req).toMatchObject({ pointName: 'Home_Hero', authMode: 'auto', requiresAuth: true });
        expect(req.context).toMatchObject({ dataspace: 'default', productId: 'SKU-1' });
        expect(req.context.individualId).toMatch(/^[0-9a-f]{16}$/);

        expect($(el, '[data-id="mode-badge"]').textContent).toBe('Authenticated');
        expect($(el, '[data-id="mode-detail"]').textContent).toContain('Invocable action');
        expect($(el, '.answered-block').textContent).toContain('dec-1');

        const saved = JSON.parse(localStorage.getItem('p13n_sim_context'));
        expect(saved.contextRows).toEqual([{ key: 'productId', value: 'SKU-1' }]);
    });

    it('flags reserved context keys', async () => {
        const el = await mount();
        button(el, 'Add key').click();
        await flush();
        typeInto($$(el, '.context-row lightning-input')[0], 'individualId');
        await flush();
        expect(el.shadowRoot.textContent).toContain('Ignored (set by the simulator): individualId');
        $(el, '.context-row lightning-button-icon').click();
        await flush();
        expect($$(el, '.context-row').length).toBe(0);
    });

    it('looks up the decision and cohort in the logs on request', async () => {
        runDecision.mockResolvedValue({ success: true, httpStatus: 200, responseJson: RESPONSE('Shoe'), mode: 'Unauthenticated', modeDetail: 'x', notes: ['n1'] });
        lookupDecisionLog.mockResolvedValue({
            found: true,
            entries: [{ decisionName: 'Decision A', personalizerName: 'Recs', experimentName: 'Test 1', cohortName: 'Variant B', cohortIsControl: true, treatment: 'B', statusCode: '200', requestDateTime: 't' }]
        });
        const el = await mount();
        button(el, 'Simulate').click();
        await flush();
        await flush();
        expect(lookupDecisionLog).not.toHaveBeenCalled();

        button(el, 'Look up in logs').click();
        await flush();
        await flush();
        expect(lookupDecisionLog).toHaveBeenCalledWith({ requestId: 'req-Shoe' });
        const table = $(el, '[data-id="log-table"]');
        expect(table.textContent).toContain('Decision A');
        expect(table.textContent).toContain('Variant B (control)');

        lookupDecisionLog.mockResolvedValue({ found: false, message: 'No log rows for this request yet.' });
        button(el, 'Look up in logs').click();
        await flush();
        await flush();
        expect($(el, '[data-id="log-message"]').textContent).toBe('No log rows for this request yet.');

        lookupDecisionLog.mockRejectedValue({ body: { message: 'boom' } });
        button(el, 'Look up in logs').click();
        await flush();
        await flush();
        expect($(el, '[data-id="log-message"]').textContent).toBe('boom');
    });

    it('compares two visitors side by side', async () => {
        runDecision
            .mockResolvedValueOnce({ success: true, httpStatus: 200, responseJson: RESPONSE('Shoe'), mode: 'Unauthenticated', modeDetail: '', notes: [] })
            .mockResolvedValueOnce({ success: true, httpStatus: 200, responseJson: RESPONSE('Hat'), mode: 'Unauthenticated', modeDetail: '', notes: [] });
        const el = await mount();
        button(el, 'Add Random').click();
        await flush();
        button(el, 'Simulate All').click();
        await flush();
        await flush();

        expect($(el, '[data-id="compare"]')).not.toBeNull();
        const keys = $(el, '[data-id="compare-a"]').options.map((o) => o.value);
        expect(keys.length).toBe(2);
        $(el, '[data-id="compare-a"]').dispatchEvent(new CustomEvent('change', { detail: { value: keys[0] } }));
        $(el, '[data-id="compare-b"]').dispatchEvent(new CustomEvent('change', { detail: { value: keys[1] } }));
        await flush();

        expect($(el, '[data-id="compare-summary"]').textContent).toBe('1 value differs.');
        const rows = $$(el, '[data-id="compare-table"] tbody tr');
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('"Shoe"');
        expect(rows[0].textContent).toContain('"Hat"');
        expect(rows[0].className).toBe('compare-diff');
    });

    it('renders the response through the pasted template in a sandboxed frame', async () => {
        runDecision.mockResolvedValue({ success: true, httpStatus: 200, responseJson: RESPONSE('Shoe'), mode: 'Unauthenticated', modeDetail: '', notes: [] });
        const el = await mount();
        const textarea = $(el, 'lightning-textarea');
        textarea.value = '<h2>{{attributes.header}}</h2>{{#each data}}<p>{{name}}</p>{{/each}}';
        textarea.dispatchEvent(new CustomEvent('change'));
        button(el, 'Simulate').click();
        await flush();
        await flush();

        const previewButton = $$(el, 'button').find((b) => b.textContent.trim() === 'Preview');
        previewButton.click();
        await flush();
        const frame = $(el, '[data-id="preview-frame"]');
        expect(frame.getAttribute('sandbox')).toBe('');
        expect(decodeURIComponent(frame.getAttribute('src'))).toContain('<h2>Hello</h2><p>Shoe</p>');
        expect($(el, '[data-id="preview-html"]').textContent).toBe('<h2>Hello</h2><p>Shoe</p>');
        expect(localStorage.getItem('p13n_sim_template')).toContain('attributes.header');

        textarea.value = '{{#if x}}broken';
        textarea.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect($(el, '[data-id="preview-error"]').textContent).toContain('Missing {{/if}}');
    });

    it('shows the mode with the error when the call fails', async () => {
        runDecision.mockResolvedValue({
            success: false, httpStatus: 0, errorMessage: 'Could not get a Data Cloud token',
            mode: 'Authenticated', modeDetail: 'Token exchange failed.', notes: ['Invocable action not used: x']
        });
        const el = await mount();
        button(el, 'Simulate').click();
        await flush();
        await flush();
        expect(el.shadowRoot.textContent).toContain('Could not get a Data Cloud token');
        expect(el.shadowRoot.textContent).toContain('Token exchange failed.');
        expect(el.shadowRoot.textContent).toContain('Invocable action not used: x');
    });

    it('requires a TSE URL only for the unauthenticated path', async () => {
        getConfig.mockResolvedValue({ tseBaseUrl: '', dataspace: 'default' });
        getPointInfo.mockResolvedValue({ apiName: 'Home_Hero', requiresAuth: false });
        getRecentDeviceIds.mockResolvedValue([]);
        const el = createElement('c-personalization-simulator', { is: PersonalizationSimulator });
        el.recordId = '9ppAA0000000001AAA';
        document.body.appendChild(el);
        await flush();
        button(el, 'Simulate').click();
        await flush();
        expect(runDecision).not.toHaveBeenCalled();
        expect(el.shadowRoot.textContent).toContain('TSE Base URL is required.');

        $(el, '[data-id="auth-mode"]').dispatchEvent(new CustomEvent('change', { detail: { value: 'authenticated' } }));
        runDecision.mockResolvedValue({ success: true, httpStatus: 200, responseJson: RESPONSE('Shoe'), mode: 'Authenticated', modeDetail: '', notes: [] });
        button(el, 'Simulate').click();
        await flush();
        expect(runDecision).toHaveBeenCalled();
        expect(JSON.parse(runDecision.mock.calls[0][0].requestJson).authMode).toBe('authenticated');
    });

    it('uses the API version from config, lets the user change it, and keeps it', async () => {
        getConfig.mockResolvedValue({ tseBaseUrl: 'https://tenant.example', dataspace: 'default', orgBaseUrl: 'https://org.example', apiVersion: '66.0' });
        getPointInfo.mockResolvedValue({ apiName: 'Home_Hero', requiresAuth: false });
        getRecentDeviceIds.mockResolvedValue([]);
        getDataGraphValues.mockResolvedValue('{"data":[]}');
        const el = createElement('c-personalization-simulator', { is: PersonalizationSimulator });
        el.recordId = '9ppAA0000000001AAA';
        document.body.appendChild(el);
        await flush();
        const input = $$(el, 'lightning-input').find((i) => i.label === 'API version');
        expect(input.value).toBe('66.0');
        typeInto(input, '65.0');
        runDecision.mockResolvedValue({ success: true, httpStatus: 200, responseJson: RESPONSE('Shoe'), mode: 'Unauthenticated', modeDetail: '', notes: [] });
        button(el, 'Simulate').click();
        await flush();
        await flush();
        button(el, 'Lookup Profile').click();
        await flush();
        expect(getDataGraphValues).toHaveBeenCalledWith(expect.objectContaining({ apiVersion: '65.0', orgBaseUrl: 'https://org.example' }));
        expect(JSON.parse(localStorage.getItem('p13n_sim_context')).apiVersion).toBe('65.0');
    });
});
