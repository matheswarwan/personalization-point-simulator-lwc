import { LightningElement, api, track } from 'lwc';
import getConfig from '@salesforce/apex/PersonalizationSimulatorController.getConfig';
import getPersonalizationPointApiName from '@salesforce/apex/PersonalizationSimulatorController.getPersonalizationPointApiName';
import simulate from '@salesforce/apex/PersonalizationSimulatorController.simulate';

// ── Utilities ────────────────────────────────────────────────────

function generateDeviceId() {
    return [...Array(16)]
        .map(() => Math.floor(Math.random() * 16).toString(16))
        .join('');
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
        .replace(/^ssot__/, '')
        .replace(/__c$/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Component ────────────────────────────────────────────────────

export default class PersonalizationSimulator extends LightningElement {
    @api recordId;

    // State
    @track individualId  = generateDeviceId();
    @track isLoading     = false;
    @track error         = null;

    // Config — auto-detected via ConnectApi or loaded from CMT, user-editable in-place
    @track tseBaseUrl    = '';
    @track dataspace     = 'default';
    @track autoDetected  = false;

    // Personalization Point API name (from SOQL)
    @track ppApiName     = '';

    // Response
    @track rawJson           = '';
    @track tableColumns      = [];
    @track tableRows         = [];
    @track attributeItems    = [];
    @track personalizationId = '';
    @track requestId         = '';
    @track httpStatus        = null;
    @track hasResponse       = false;
    @track showJson          = false;
    @track showTable         = true;

    // ── Lifecycle ────────────────────────────────────────────────

    connectedCallback() {
        this.loadConfig();
        this.loadApiName();
    }

    async loadConfig() {
        try {
            const config = await getConfig();
            this.tseBaseUrl   = config.tseBaseUrl   || '';
            this.dataspace    = config.dataspace     || 'default';
            this.autoDetected = config.autoDetected  || false;
        } catch (e) {
            this.error = 'Failed to load config: ' + (e.body?.message || e.message);
        }
    }

    async loadApiName() {
        try {
            this.ppApiName = await getPersonalizationPointApiName({ recordId: this.recordId });
        } catch (e) {
            this.error = 'Failed to load Personalization Point API name: ' + (e.body?.message || e.message);
        }
    }

    // ── Handlers ─────────────────────────────────────────────────

    handleTseUrlChange(event) {
        this.tseBaseUrl = event.target.value;
    }

    handleIndividualIdChange(event) {
        this.individualId = event.target.value;
    }

    handleRandomize() {
        this.individualId = generateDeviceId();
    }

    handleToggleView(event) {
        const view = event.target.dataset.view;
        this.showTable = (view === 'table');
        this.showJson  = (view === 'json');
    }

    async handleSimulate() {
        if (!this.ppApiName) {
            this.error = 'Personalization Point API name not loaded yet.';
            return;
        }
        if (!this.tseBaseUrl?.trim()) {
            this.error = 'TSE Base URL is required. It will auto-populate if Data Cloud ConnectApi is available, otherwise update the Personalization_Config__mdt record.';
            return;
        }
        if (!this.individualId?.trim()) {
            this.error = 'Individual / Device ID is required.';
            return;
        }

        this.isLoading   = true;
        this.error       = null;
        this.hasResponse = false;

        try {
            const result = await simulate({
                personalizationPointName: this.ppApiName,
                individualId:            this.individualId.trim(),
                tseBaseUrl:              this.tseBaseUrl.trim(),
                dataspace:               this.dataspace || 'default'
            });

            this.httpStatus = result.httpStatus;

            if (result.success) {
                this.rawJson = this.formatJson(result.responseJson);
                this.parseResponse(result.responseJson);
                this.hasResponse = true;
                this.showTable   = true;
                this.showJson    = false;
            } else {
                this.error = result.errorMessage || 'Unknown error from Decisioning API';
            }
        } catch (e) {
            this.error = e.body?.message || e.message;
        } finally {
            this.isLoading = false;
        }
    }

    // ── Response Parsing ─────────────────────────────────────────

    parseResponse(jsonString) {
        let parsed;
        try {
            parsed = JSON.parse(jsonString);
        } catch {
            this.error = 'Could not parse API response as JSON';
            return;
        }

        this.requestId = parsed.requestId || '';

        const personalizations = parsed.personalizations || [];
        if (personalizations.length === 0) {
            this.tableColumns      = [];
            this.tableRows         = [];
            this.attributeItems    = [];
            this.personalizationId = '';
            return;
        }

        const p = personalizations[0];
        this.personalizationId = p.personalizationId || '';

        this.attributeItems = Object.entries(p.attributes || {}).map(([key, value]) => ({ key, value }));

        const EXCLUDED_FIELDS = ['personalizationContentId'];
        const data = p.data || [];

        if (data.length === 0) {
            this.tableColumns = [];
            this.tableRows    = [];
            return;
        }

        const sampleRow  = data[0];
        const fieldNames = Object.keys(sampleRow).filter(f => !EXCLUDED_FIELDS.includes(f));

        const columnMeta = fieldNames.map(fieldName => {
            const sampleValue = sampleRow[fieldName];
            const isImg  = isImageUrl(sampleValue);
            const isLink = !isImg && isUrl(sampleValue);
            return { fieldName, label: formatColumnLabel(fieldName), isImage: isImg, isUrl: isLink, isText: !isImg && !isLink };
        });

        this.tableColumns = columnMeta;
        this.tableRows = data.map((item, index) => ({
            id: item.personalizationContentId || String(index),
            cells: columnMeta.map(col => ({
                fieldName: col.fieldName,
                label:     col.label,
                value:     item[col.fieldName] ?? '',
                isImage:   col.isImage,
                isUrl:     col.isUrl,
                isText:    col.isText
            }))
        }));
    }

    formatJson(jsonString) {
        try { return JSON.stringify(JSON.parse(jsonString), null, 2); }
        catch { return jsonString; }
    }

    // ── Computed ─────────────────────────────────────────────────

    get simulateButtonLabel() {
        return this.isLoading ? 'Simulating...' : 'Simulate';
    }

    get tseFieldLabel() {
        return this.autoDetected ? 'TSE Base URL (auto-detected)' : 'TSE Base URL';
    }

    get statusBadgeClass() {
        if (!this.httpStatus) return '';
        return this.httpStatus === 200 ? 'slds-badge slds-theme_success' : 'slds-badge slds-theme_error';
    }

    get tableButtonClass() {
        return 'slds-button slds-button_neutral' + (this.showTable ? ' slds-is-selected' : '');
    }

    get jsonButtonClass() {
        return 'slds-button slds-button_neutral' + (this.showJson ? ' slds-is-selected' : '');
    }

    get hasAttributes() {
        return this.attributeItems.length > 0;
    }

    get hasTableData() {
        return this.tableRows.length > 0;
    }
}
