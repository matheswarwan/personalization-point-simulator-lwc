import { LightningElement, api, track } from 'lwc';
import getConfig from '@salesforce/apex/PersonalizationSimulatorController.getConfig';
import getPersonalizationPointApiName from '@salesforce/apex/PersonalizationSimulatorController.getPersonalizationPointApiName';
import getRecentDeviceIds from '@salesforce/apex/PersonalizationSimulatorController.getRecentDeviceIds';
import getDataGraphValues from '@salesforce/apex/PersonalizationSimulatorController.getDataGraphValues';
import getPointInfo from '@salesforce/apex/PersonalizationSimulatorController.getPointInfo';
import runDecision from '@salesforce/apex/PersonalizationSimulatorController.runDecision';
import lookupDecisionLog from '@salesforce/apex/PersonalizationSimulatorController.lookupDecisionLog';
import {
    buildContext, contextRowsToMap, extractDecisionInfo, diffResponses,
    renderTemplate, templateData, previewDocument, previewDataUrl
} from './simulatorUtils';

const AUTH_MODES = [
    { label: 'Auto (follow the point setting)', value: 'auto' },
    { label: 'Authenticated', value: 'authenticated' },
    { label: 'Unauthenticated', value: 'unauthenticated' }
];
const TEMPLATE_KEY = 'p13n_sim_template';

// ── Utilities ────────────────────────────────────────────────────

function generateDeviceId() {
    return [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

function isImageUrl(value) {
    if (typeof value !== 'string') return false;
    return /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(value);
}

function isUrl(value) {
    if (typeof value !== 'string') return false;
    try { new URL(value); return true; } catch { return false; }
}

function formatColumnLabel(apiName) {
    return apiName
        .replace(/^ssot__/, '').replace(/__c$/, '')
        .replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function sourceMeta(source) {
    if (source === 'recent') return { sourceLabel: 'Real Visitor', sourceBadgeClass: 'source-badge source-badge_recent' };
    if (source === 'manual') return { sourceLabel: 'Custom',       sourceBadgeClass: 'source-badge source-badge_manual' };
    return                          { sourceLabel: 'Random',       sourceBadgeClass: 'source-badge source-badge_random' };
}

let _keyCounter = 0;
function makeEntry(individualId, source, index) {
    const src = source || 'random';
    return {
        key:             String(++_keyCounter),
        individualId:    individualId || generateDeviceId(),
        source:          src,
        tabLabel:        `Visitor ${index + 1}`,
        ...sourceMeta(src),
        isLoading:       false,
        hasResult:       false,
        error:           null,
        rawJson:         '',
        rawRequestJson:  '',
        tableColumns:    [],
        tableRows:       [],
        attributeItems:  [],
        personalizationId: '',
        requestId:       '',
        httpStatus:      null,
        statusBadgeClass: '',
        showTable:       true,
        showRequest:     false,
        showJson:        false,
        dataGraphLoading: false,
        dataGraphResult:  null,
        dataGraphError:   null,
        showDataGraph:    false,
        showPreview:      false,
        mode:             '',
        modeDetail:       '',
        modeNotes:        [],
        answerInfo:       [],
        logLoading:       false,
        logEntries:       [],
        logMessage:       ''
    };
}

let _rowCounter = 0;
function makeRow(key, value) {
    return { id: String(++_rowCounter), key: key || '', value: value || '' };
}

// ── Component ────────────────────────────────────────────────────

export default class PersonalizationSimulator extends LightningElement {
    @api recordId;

    @track entries      = [];
    @track tseBaseUrl   = '';
    @track dataspace    = 'default';
    @track orgBaseUrl   = '';
    @track autoDetected    = false;
    @track ppApiName       = '';
    @track recentIds       = [];
    @track globalError     = null;
    @track requiresAuth    = null;   // the point's IsAuthenticationRequired; null = unknown
    @track authMode        = 'auto';
    @track contextRows     = [];
    @track compareA        = '';
    @track compareB        = '';
    @track onlyDiffs       = true;
    @track templateText    = '';
    authModeOptions        = AUTH_MODES;

    // ── Request Context ──────────────────────────────────────────
    @track requestUrl      = '';
    @track pageType        = '';
    @track interaction     = '';
    @track channelContext  = '';
    @track channel         = 'Web';
    @track requestTimeZone = '';

    // ── Lifecycle ────────────────────────────────────────────────

    connectedCallback() {
        this.entries = [makeEntry(null, 'random', 0)];
        this.requestTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        this.restoreContext();
        this.loadConfig();
        this.loadPointInfo();
        this.loadRecentDeviceIds();
    }

    async loadConfig() {
        try {
            const config = await getConfig();
            // Only use config URLs if localStorage didn't already restore them
            if (!this.tseBaseUrl)  this.tseBaseUrl  = config.tseBaseUrl  || '';
            if (!this.orgBaseUrl)  this.orgBaseUrl  = config.orgBaseUrl  || '';
            this.dataspace    = config.dataspace     || 'default';
            this.autoDetected = config.autoDetected  || false;
        } catch (e) {
            this.globalError = 'Failed to load config: ' + (e.body?.message || e.message);
        }
    }

    async loadPointInfo() {
        try {
            const info = await getPointInfo({ recordId: this.recordId });
            this.ppApiName = info.apiName;
            this.requiresAuth = info.requiresAuth === undefined ? null : info.requiresAuth;
        } catch (e) {
            await this.loadApiName();
        }
    }

    async loadApiName() {
        try {
            this.ppApiName = await getPersonalizationPointApiName({ recordId: this.recordId });
        } catch (e) {
            this.globalError = 'Failed to load Personalization Point API name: ' + (e.body?.message || e.message);
        }
    }

    async loadRecentDeviceIds() {
        try {
            const ids = await getRecentDeviceIds();
            if (ids && ids.length > 0) {
                this.recentIds = ids;
                // Auto-populate first entry with the most recent real visitor
                this.updateEntry(this.entries[0].key, {
                    individualId: ids[0],
                    source: 'recent',
                    ...sourceMeta('recent')
                });
            }
        } catch (e) {
            // Non-fatal — keep the random ID already set
        }
    }

    // ── Entry management ─────────────────────────────────────────

    updateEntry(key, updates) {
        this.entries = this.entries.map(e => e.key === key ? { ...e, ...updates } : e);
    }

    rebuildTabLabels() {
        this.entries = this.entries.map((e, i) => ({ ...e, tabLabel: `Visitor ${i + 1}` }));
    }

    handleEntryIdChange(event) {
        const key   = event.target.dataset.key;
        const value = event.target.value;
        this.updateEntry(key, { individualId: value, source: 'manual', ...sourceMeta('manual') });
    }

    handleAddRandom() {
        if (this.entries.length >= 10) return;
        this.entries = [...this.entries, makeEntry(null, 'random', this.entries.length)];
        this.rebuildTabLabels();
    }

    handleAddRecent(event) {
        const id = event.detail.value;
        if (!id) return;
        if (this.entries.length >= 10) {
            event.target.value = '';
            return;
        }
        this.entries = [...this.entries, makeEntry(id, 'recent', this.entries.length)];
        this.rebuildTabLabels();
        event.target.value = '';
    }

    handleRemoveEntry(event) {
        if (this.entries.length <= 1) return;
        const key = event.target.dataset.key;
        this.entries = this.entries.filter(e => e.key !== key);
        this.rebuildTabLabels();
    }

    // ── Handlers ─────────────────────────────────────────────────

    saveContext() {
        try {
            const ctx = {
                tseBaseUrl:    this.tseBaseUrl,
                orgBaseUrl:    this.orgBaseUrl,
                requestUrl:    this.requestUrl,
                pageType:      this.pageType,
                interaction:   this.interaction,
                channel:       this.channel,
                channelContext: this.channelContext,
                requestTimeZone: this.requestTimeZone,
                authMode:      this.authMode,
                contextRows:   this.contextRows.map(r => ({ key: r.key, value: r.value }))
            };
            localStorage.setItem('p13n_sim_context', JSON.stringify(ctx));
        } catch (e) { /* storage unavailable */ }
    }

    restoreContext() {
        try {
            const raw = localStorage.getItem('p13n_sim_context');
            if (!raw) return;
            const ctx = JSON.parse(raw);
            if (ctx.tseBaseUrl)     this.tseBaseUrl     = ctx.tseBaseUrl;
            if (ctx.orgBaseUrl)     this.orgBaseUrl     = ctx.orgBaseUrl;
            if (ctx.requestUrl)     this.requestUrl     = ctx.requestUrl;
            if (ctx.pageType)       this.pageType       = ctx.pageType;
            if (ctx.interaction)    this.interaction    = ctx.interaction;
            if (ctx.channel)        this.channel        = ctx.channel;
            if (ctx.channelContext) this.channelContext = ctx.channelContext;
            if (ctx.requestTimeZone) this.requestTimeZone = ctx.requestTimeZone;
            if (ctx.authMode)       this.authMode       = ctx.authMode;
            if (Array.isArray(ctx.contextRows)) this.contextRows = ctx.contextRows.map(r => makeRow(r.key, r.value));
        } catch (e) { /* corrupt storage — ignore */ }
        try {
            this.templateText = localStorage.getItem(TEMPLATE_KEY) || '';
        } catch (e) { /* storage unavailable */ }
    }

    handleRequestUrlChange(event)     { this.requestUrl     = event.target.value; this.saveContext(); }
    handlePageTypeChange(event)       { this.pageType       = event.target.value; this.saveContext(); }
    handleInteractionChange(event)    { this.interaction    = event.target.value; this.saveContext(); }
    handleChannelContextChange(event) { this.channelContext = event.target.value; this.saveContext(); }
    handleChannelChange(event)        { this.channel        = event.target.value; this.saveContext(); }
    handleRequestTimeZoneChange(event){ this.requestTimeZone = event.target.value; this.saveContext(); }

    handleAuthModeChange(event) { this.authMode = event.detail.value; this.saveContext(); }

    // ── Decision context rows ────────────────────────────────────

    handleAddContextRow() {
        this.contextRows = [...this.contextRows, makeRow()];
    }

    handleContextRowChange(event) {
        const id = event.target.dataset.id;
        const field = event.target.dataset.field;
        const value = event.target.value;
        this.contextRows = this.contextRows.map(r => r.id === id ? { ...r, [field]: value } : r);
        this.saveContext();
    }

    handleRemoveContextRow(event) {
        const id = event.target.dataset.id;
        this.contextRows = this.contextRows.filter(r => r.id !== id);
        this.saveContext();
    }

    get hasContextRows() { return this.contextRows.length > 0; }

    get ignoredContextKeys() {
        const { ignored } = contextRowsToMap(this.contextRows);
        return ignored.length ? `Ignored (set by the simulator): ${ignored.join(', ')}` : '';
    }

    // ── Template preview ─────────────────────────────────────────

    handleTemplateChange(event) {
        this.templateText = event.target.value;
        try { localStorage.setItem(TEMPLATE_KEY, this.templateText); } catch (e) { /* storage unavailable */ }
    }

    // ── Compare ──────────────────────────────────────────────────

    get resultEntries() { return this.entries.filter(e => e.hasResult); }
    get canCompare()    { return this.resultEntries.length >= 2; }
    get compareOptions() {
        return this.resultEntries.map(e => ({ label: `${e.tabLabel} (${e.individualId})`, value: e.key }));
    }

    handleCompareAChange(event)  { this.compareA = event.detail.value; }
    handleCompareBChange(event)  { this.compareB = event.detail.value; }
    handleOnlyDiffsChange(event) { this.onlyDiffs = event.target.checked; }

    get compareRows() {
        const a = this.entries.find(e => e.key === this.compareA && e.hasResult);
        const b = this.entries.find(e => e.key === this.compareB && e.hasResult);
        if (!a || !b || a === b) return [];
        return diffResponses(a.rawJson, b.rawJson)
            .filter(r => !this.onlyDiffs || r.differs)
            .map(r => ({ ...r, rowClass: r.differs ? 'compare-diff' : (r.volatile ? 'compare-volatile' : '') }));
    }

    get compareSummary() {
        const a = this.entries.find(e => e.key === this.compareA && e.hasResult);
        const b = this.entries.find(e => e.key === this.compareB && e.hasResult);
        if (!a || !b) return 'Pick two visitors with results.';
        if (a === b) return 'Pick two different visitors.';
        const diffs = diffResponses(a.rawJson, b.rawJson).filter(r => r.differs).length;
        const modes = a.mode !== b.mode ? ` Modes differ: ${a.mode} vs ${b.mode}.` : '';
        return (diffs ? `${diffs} ${diffs === 1 ? 'value differs' : 'values differ'}.` : 'Same decision content (IDs that change per call are ignored).') + modes;
    }

    get compareLabelA() { return this.entries.find(e => e.key === this.compareA)?.tabLabel || 'A'; }
    get compareLabelB() { return this.entries.find(e => e.key === this.compareB)?.tabLabel || 'B'; }
    get hasCompareRows() { return this.compareRows.length > 0; }

    get requiresAuthLabel() {
        if (this.requiresAuth === true)  return 'Point requires authentication: yes';
        if (this.requiresAuth === false) return 'Point requires authentication: no';
        return 'Point authentication setting: unknown';
    }

    handleTseUrlChange(event) {
        this.tseBaseUrl = event.target.value;
        this.saveContext();
    }

    handleOrgBaseUrlChange(event) {
        this.orgBaseUrl = event.target.value;
        this.saveContext();
    }

    handleTabToggle(event) {
        const key  = event.target.dataset.key;
        const view = event.target.dataset.view;
        this.updateEntry(key, {
            showTable:     view === 'table',
            showRequest:   view === 'request',
            showJson:      view === 'json',
            showDataGraph: view === 'datagraph',
            showPreview:   view === 'preview'
        });
    }

    async handleLogLookup(event) {
        const key   = event.target.dataset.key;
        const entry = this.entries.find(e => e.key === key);
        if (!entry || !entry.requestId) {
            this.updateEntry(key, { logMessage: 'This response has no requestId to look up.' });
            return;
        }
        this.updateEntry(key, { logLoading: true, logMessage: '', logEntries: [] });
        try {
            const r = await lookupDecisionLog({ requestId: entry.requestId });
            const logEntries = (r.entries || []).map((x, i) => ({
                ...x,
                id: String(i),
                decision:     x.decisionName || x.decisionId || '',
                personalizer: x.personalizerName || x.personalizerId || '',
                experiment:   x.experimentName || x.experimentId || '',
                cohort:       (x.cohortName || x.cohortId || '') + (x.cohortIsControl ? ' (control)' : '')
            }));
            this.updateEntry(key, { logLoading: false, logEntries, logMessage: r.found ? '' : (r.message || 'Nothing found.') });
        } catch (e) {
            this.updateEntry(key, { logLoading: false, logMessage: e.body?.message || e.message });
        }
    }

    /** Preview document for one entry's response through the experience template. */
    previewFor(entry) {
        const none = { previewSrc: '', previewHtml: '', previewError: '' };
        if (!this.templateText.trim() || !entry.rawJson) return none;
        try {
            const html = renderTemplate(this.templateText, templateData(JSON.parse(entry.rawJson)));
            // LWC disallows srcdoc, so the document goes in as a data: URL; sandbox="" keeps
            // scripts, forms and same-origin access off.
            // ASSUMPTION: Lightning's CSP allows data: frames; the HTML source is shown as well.
            return { ...none, previewSrc: previewDataUrl(previewDocument(html)), previewHtml: html };
        } catch (e) {
            return { ...none, previewError: 'Template could not be rendered: ' + e.message };
        }
    }

    get entriesView() {
        return this.entries.map(e => ({
            ...e,
            ...(e.showPreview ? this.previewFor(e) : { previewSrc: '', previewHtml: '', previewError: '' }),
            hasAnswerInfo: e.answerInfo.length > 0,
            hasLogEntries: e.logEntries.length > 0,
            hasModeNotes:  e.modeNotes.length > 0,
            modeBadgeClass: e.mode === 'Authenticated' ? 'slds-badge slds-badge_inverse' : 'slds-badge'
        }));
    }

    get hasTemplate() { return this.templateText.trim().length > 0; }

    async handleDataGraphLookup(event) {
        const key   = event.target.dataset.key;
        const entry = this.entries.find(e => e.key === key);
        if (!entry || !entry.individualId?.trim()) return;

        // If already loaded, just toggle the view
        if (entry.dataGraphResult) {
            this.updateEntry(key, {
                showTable: false, showRequest: false, showJson: false, showDataGraph: true
            });
            return;
        }

        this.updateEntry(key, {
            dataGraphLoading: true, dataGraphError: null,
            showTable: false, showRequest: false, showJson: false, showDataGraph: true
        });

        try {
            const raw = await getDataGraphValues({
                recordId:     this.recordId,
                individualId: entry.individualId.trim(),
                dataspace:    this.dataspace || 'default',
                orgBaseUrl:   this.orgBaseUrl.trim()
            });
            this.updateEntry(key, {
                dataGraphLoading: false,
                dataGraphResult:  this.formatJson(raw),
                dataGraphError:   null
            });
        } catch (e) {
            this.updateEntry(key, {
                dataGraphLoading: false,
                dataGraphResult:  null,
                dataGraphError:   e.body?.message || e.message
            });
        }
    }

    buildContextFor(individualId) {
        return buildContext({
            individualId,
            dataspace:       this.dataspace,
            requestUrl:      this.requestUrl,
            pageType:        this.pageType,
            interaction:     this.interaction,
            channel:         this.channel,
            channelContext:  this.channelContext,
            requestTimeZone: this.requestTimeZone
        }, this.contextRows);
    }

    buildRequestJson(individualId) {
        return JSON.stringify({
            personalizationPoints: [{ name: this.ppApiName }],
            context: this.buildContextFor(individualId)
        }, null, 2);
    }

    async handleSimulate() {
        this.globalError = null;

        if (!this.ppApiName) {
            this.globalError = 'Personalization Point API name not loaded yet.';
            return;
        }
        // The authenticated path can answer through the invocable action without a TSE URL.
        const mayUseAction = this.authMode === 'authenticated' || (this.authMode === 'auto' && this.requiresAuth === true);
        if (!this.tseBaseUrl?.trim() && !mayUseAction) {
            this.globalError = 'TSE Base URL is required.';
            return;
        }

        const blankEntry = this.entries.find(e => !e.individualId?.trim());
        if (blankEntry) {
            this.globalError = 'One or more Individual / Device IDs are blank.';
            return;
        }

        // Mark all as loading
        this.entries = this.entries.map(e => ({
            ...e, isLoading: true, error: null, hasResult: false
        }));

        await Promise.all(this.entries.map(e => this.simulateEntry(e.key)));
    }

    async simulateEntry(key) {
        const entry = this.entries.find(e => e.key === key);
        if (!entry) return;

        const rawRequestJson = this.buildRequestJson(entry.individualId.trim());

        try {
            const result = await runDecision({
                requestJson: JSON.stringify({
                    pointName:    this.ppApiName,
                    tseBaseUrl:   (this.tseBaseUrl || '').trim(),
                    authMode:     this.authMode,
                    requiresAuth: this.requiresAuth,
                    context:      this.buildContextFor(entry.individualId.trim())
                })
            });

            const parsed = result.success ? this.parseResponseData(result.responseJson) : {};
            let answerInfo = [];
            if (result.success) {
                try { answerInfo = extractDecisionInfo(JSON.parse(result.responseJson)); } catch (err) { answerInfo = []; }
            }

            this.updateEntry(key, {
                isLoading:        false,
                hasResult:        result.success,
                rawRequestJson:   rawRequestJson,
                httpStatus:       result.httpStatus,
                statusBadgeClass: result.httpStatus === 200
                    ? 'slds-badge slds-theme_success'
                    : 'slds-badge slds-theme_error',
                error:        result.success ? null : (result.errorMessage || 'Unknown error'),
                showTable:    true,
                showRequest:  false,
                showJson:     false,
                showDataGraph: false,
                showPreview:  false,
                mode:         result.mode || '',
                modeDetail:   result.modeDetail || '',
                modeNotes:    result.notes || [],
                answerInfo,
                logEntries:   [],
                logMessage:   '',
                ...parsed
            });
        } catch (e) {
            this.updateEntry(key, {
                isLoading:      false,
                hasResult:      false,
                rawRequestJson: rawRequestJson,
                error:          e.body?.message || e.message
            });
        }
    }

    // ── Response Parsing ─────────────────────────────────────────

    parseResponseData(jsonString) {
        let parsed;
        try { parsed = JSON.parse(jsonString); }
        catch { return { rawJson: jsonString, tableColumns: [], tableRows: [], attributeItems: [], requestId: '', personalizationId: '' }; }

        const rawJson  = this.formatJson(jsonString);
        const requestId = parsed.requestId || '';
        const personalizations = parsed.personalizations || [];

        if (personalizations.length === 0) {
            return { rawJson, requestId, tableColumns: [], tableRows: [], attributeItems: [], personalizationId: '' };
        }

        const p = personalizations[0];
        const personalizationId = p.personalizationId || '';
        const attributeItems    = Object.entries(p.attributes || {}).map(([key, value]) => ({ key, value }));
        const data = p.data || [];

        if (data.length === 0) {
            return { rawJson, requestId, personalizationId, attributeItems, tableColumns: [], tableRows: [] };
        }

        const sampleRow  = data[0];
        const fieldNames = Object.keys(sampleRow).filter(f => f !== 'personalizationContentId');

        const columnMeta = fieldNames.map(fieldName => {
            const v = sampleRow[fieldName];
            const isImg  = isImageUrl(v);
            const isLink = !isImg && isUrl(v);
            return { fieldName, label: formatColumnLabel(fieldName), isImage: isImg, isUrl: isLink, isText: !isImg && !isLink };
        });

        const tableRows = data.map((item, i) => ({
            id: item.personalizationContentId || String(i),
            cells: columnMeta.map(col => ({
                fieldName: col.fieldName, label: col.label,
                value:     item[col.fieldName] ?? '',
                isImage:   col.isImage, isUrl: col.isUrl, isText: col.isText
            }))
        }));

        return { rawJson, requestId, personalizationId, attributeItems, tableColumns: columnMeta, tableRows };
    }

    formatJson(jsonString) {
        try { return JSON.stringify(JSON.parse(jsonString), null, 2); }
        catch { return jsonString; }
    }

    // ── Computed ─────────────────────────────────────────────────

    get canAddMore()   { return this.entries.length < 10; }
    get canRemove()    { return this.entries.length > 1; }
    get entryCount()   { return `${this.entries.length} / 10 visitors`; }
    get isSimulating() { return this.entries.some(e => e.isLoading); }
    get hasResults()   { return this.entries.some(e => e.isLoading || e.hasResult || e.error || e.dataGraphLoading || e.dataGraphResult || e.dataGraphError); }

    get simulateButtonLabel() {
        if (this.isSimulating) return 'Simulating...';
        return this.entries.length > 1 ? 'Simulate All' : 'Simulate';
    }

    get tseFieldLabel() {
        return this.autoDetected ? 'TSE Base URL (auto-detected)' : 'TSE Base URL';
    }

    get recentIdOptions() {
        if (!this.recentIds.length) return [];
        return [
            { label: '— add a recent visitor —', value: '' },
            ...this.recentIds.map((id, i) => ({
                label: i === 0 ? `${id}  (most recent)` : id,
                value: id
            }))
        ];
    }

    get hasRecentIds() { return this.recentIds.length > 0; }
}
