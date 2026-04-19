import { LightningElement, api, track } from 'lwc';
import getConfig from '@salesforce/apex/PersonalizationSimulatorController.getConfig';
import getPersonalizationPointApiName from '@salesforce/apex/PersonalizationSimulatorController.getPersonalizationPointApiName';
import getRecentDeviceIds from '@salesforce/apex/PersonalizationSimulatorController.getRecentDeviceIds';
import simulate from '@salesforce/apex/PersonalizationSimulatorController.simulate';

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
        tableColumns:    [],
        tableRows:       [],
        attributeItems:  [],
        personalizationId: '',
        requestId:       '',
        httpStatus:      null,
        statusBadgeClass: '',
        showTable:       true,
        showJson:        false
    };
}

// ── Component ────────────────────────────────────────────────────

export default class PersonalizationSimulator extends LightningElement {
    @api recordId;

    @track entries      = [];
    @track tseBaseUrl   = '';
    @track dataspace    = 'default';
    @track autoDetected    = false;
    @track ppApiName       = '';
    @track recentIds       = [];
    @track globalError     = null;

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
        this.loadConfig();
        this.loadApiName();
        this.loadRecentDeviceIds();
    }

    async loadConfig() {
        try {
            const config = await getConfig();
            this.tseBaseUrl   = config.tseBaseUrl   || '';
            this.dataspace    = config.dataspace     || 'default';
            this.autoDetected = config.autoDetected  || false;
        } catch (e) {
            this.globalError = 'Failed to load config: ' + (e.body?.message || e.message);
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

    handleRequestUrlChange(event)     { this.requestUrl     = event.target.value; }
    handlePageTypeChange(event)       { this.pageType       = event.target.value; }
    handleInteractionChange(event)    { this.interaction    = event.target.value; }
    handleChannelContextChange(event) { this.channelContext = event.target.value; }
    handleChannelChange(event)        { this.channel        = event.target.value; }
    handleRequestTimeZoneChange(event){ this.requestTimeZone = event.target.value; }

    handleTseUrlChange(event) {
        this.tseBaseUrl = event.target.value;
    }

    handleTabToggle(event) {
        const key  = event.target.dataset.key;
        const view = event.target.dataset.view;
        this.updateEntry(key, { showTable: view === 'table', showJson: view === 'json' });
    }

    async handleSimulate() {
        this.globalError = null;

        if (!this.ppApiName) {
            this.globalError = 'Personalization Point API name not loaded yet.';
            return;
        }
        if (!this.tseBaseUrl?.trim()) {
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

        try {
            const result = await simulate({
                personalizationPointName: this.ppApiName,
                individualId:            entry.individualId.trim(),
                tseBaseUrl:              this.tseBaseUrl.trim(),
                dataspace:               this.dataspace || 'default',
                requestUrl:              this.requestUrl.trim(),
                pageType:                this.pageType.trim(),
                interaction:             this.interaction.trim(),
                channelContext:          this.channelContext.trim(),
                channel:                 this.channel.trim(),
                requestTimeZone:         this.requestTimeZone.trim()
            });

            const parsed = result.success ? this.parseResponseData(result.responseJson) : {};

            this.updateEntry(key, {
                isLoading:        false,
                hasResult:        result.success,
                httpStatus:       result.httpStatus,
                statusBadgeClass: result.httpStatus === 200
                    ? 'slds-badge slds-theme_success'
                    : 'slds-badge slds-theme_error',
                error:     result.success ? null : (result.errorMessage || 'Unknown error'),
                showTable: true,
                showJson:  false,
                ...parsed
            });
        } catch (e) {
            this.updateEntry(key, {
                isLoading: false,
                hasResult: false,
                error:     e.body?.message || e.message
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
    get hasResults()   { return this.entries.some(e => e.isLoading || e.hasResult || e.error); }

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
