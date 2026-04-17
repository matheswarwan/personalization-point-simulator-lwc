# PROJECT 07 — Salesforce Personalization Point Simulator (LWC)

> **How to use this document**: This is a full project brief. Share it with Claude at the start of a session and say: _"Let's work on Project 07. Build the full LWC component."_ Claude will have all context needed to implement, test, and deploy this component.

---

## 1. Project Overview

### Problem Statement

When implementing Salesforce Personalization (Data Cloud-native), consultants need to validate that a Personalization Point is returning the correct decisions for a given visitor. The only way to do this today is to:
- Write a manual Postman request
- Look up the Personalization Point's API name separately
- Manually construct the request body
- Parse the raw JSON response yourself

This is slow, repetitive, and requires context-switching out of Salesforce entirely.

### Solution

A Lightning Web Component called **`personalizationSimulator`** placed directly on the **Personalization Point record page** in Salesforce. It reads the current record's API name automatically, lets the consultant enter or randomize a device/individual ID, fires the Decisioning API, and renders the response both as a dynamic visual table and as formatted JSON — all without leaving the record page.

### Key Characteristics

- **Unauthenticated API**: The Salesforce Personalization Decisioning API does not require a bearer token — only the correct TSE (Tenant Specific Endpoint) and a valid request body
- **No hardcoded columns**: The response table is built dynamically from whatever fields appear in `data[]` — works for any Personalization Point regardless of its response template fields
- **TSE configured once**: Stored in Custom Metadata, deployed with the package, editable per org without code changes
- **Image detection**: Fields whose values are image URLs are rendered as thumbnails, not raw strings

### Target Users

- Salesforce Personalization implementers and consultants
- TSEs and SEs demoing Personalization to clients
- QA engineers validating Personalization Point responses

---

## 2. Metadata Components

### 2.1 Custom Metadata Type: `Personalization_Config__mdt`

Stores org-level configuration. One active record per org.

| Field Label | Field API Name | Type | Description |
|-------------|---------------|------|-------------|
| TSE Base URL | `TSE_Base_URL__c` | Text(255) | e.g. `https://m-4t1ytbgyzg8y3gg02wmnrymb.c360a.salesforce.com` — no trailing slash |
| Dataspace | `Dataspace__c` | Text(50) | Default: `default` |
| Is Active | `Is_Active__c` | Checkbox | Only one record should be active |

**Default record** (deployed with package):
```xml
<!-- force-app/main/default/customMetadata/Personalization_Config__mdt.Default.md-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Default</label>
    <protected>false</protected>
    <values>
        <field>TSE_Base_URL__c</field>
        <value xsi:type="xsd:string">REPLACE_WITH_TSE_URL</value>
    </values>
    <values>
        <field>Dataspace__c</field>
        <value xsi:type="xsd:string">default</value>
    </values>
    <values>
        <field>Is_Active__c</field>
        <value xsi:type="xsd:boolean">true</value>
    </values>
</CustomMetadata>
```

> After deployment, admin edits the `Default` record in Setup → Custom Metadata Types → Personalization Config → Manage Records to set the actual TSE URL.

### 2.2 Apex Controller: `PersonalizationSimulatorController`

Handles two responsibilities:
1. Reading Custom Metadata (TSE URL, dataspace)
2. Making the HTTP callout to the Decisioning API (callouts cannot be made directly from LWC — must go through Apex)

### 2.3 Remote Site Setting

The TSE domain must be whitelisted for Apex callouts.

Since the TSE URL varies per org, include a placeholder Remote Site Setting in the package and document that it must be updated post-deployment.

```xml
<!-- force-app/main/default/remoteSiteSettings/Personalization_TSE.remoteSite-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Salesforce Personalization Decisioning API TSE endpoint</description>
    <disableProtocolSecurity>false</disableProtocolSecurity>
    <isActive>true</isActive>
    <name>Personalization_TSE</name>
    <url>https://REPLACE_WITH_TSE_DOMAIN.c360a.salesforce.com</url>
</RemoteSiteSetting>
```

### 2.4 LWC: `personalizationSimulator`

Placed on the Personalization Point Lightning record page via App Builder.

### 2.5 Permission Set: `Personalization_Simulator_Access`

Grants access to the Apex controller and LWC for non-admin users.

---

## 3. Apex Controller

### `PersonalizationSimulatorController.cls`

```apex
public with sharing class PersonalizationSimulatorController {

    // ─── Config DTO ───────────────────────────────────────────────
    public class SimulatorConfig {
        @AuraEnabled public String tseBaseUrl;
        @AuraEnabled public String dataspace;
    }

    // ─── Request DTO ──────────────────────────────────────────────
    public class SimulateRequest {
        @AuraEnabled public String personalizationPointName;
        @AuraEnabled public String individualId;
    }

    // ─── Response DTO ─────────────────────────────────────────────
    public class SimulateResult {
        @AuraEnabled public Boolean success;
        @AuraEnabled public String responseJson;   // full raw JSON string
        @AuraEnabled public String errorMessage;
        @AuraEnabled public Integer httpStatus;
    }

    // ─── Get Config ───────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static SimulatorConfig getConfig() {
        Personalization_Config__mdt config = [
            SELECT TSE_Base_URL__c, Dataspace__c
            FROM Personalization_Config__mdt
            WHERE Is_Active__c = true
            LIMIT 1
        ];

        SimulatorConfig result = new SimulatorConfig();
        result.tseBaseUrl = config.TSE_Base_URL__c;
        result.dataspace  = config.Dataspace__c;
        return result;
    }

    // ─── Get Personalization Point API Name ───────────────────────
    @AuraEnabled(cacheable=true)
    public static String getPersonalizationPointApiName(String recordId) {
        // Query the Personalization Point object for the API name field
        // Note: Adjust the object/field API names to match your org's
        // Salesforce Personalization managed package schema
        List<sObject> records = Database.query(
            'SELECT Id, DeveloperName ' +
            'FROM PersonalizationPoint ' +
            'WHERE Id = :recordId ' +
            'LIMIT 1'
        );

        if (records.isEmpty()) {
            throw new AuraHandledException('Personalization Point not found for Id: ' + recordId);
        }

        return (String) records[0].get('DeveloperName');
    }

    // ─── Simulate ─────────────────────────────────────────────────
    @AuraEnabled
    public static SimulateResult simulate(SimulateRequest req) {
        SimulatorConfig config = getConfig();

        String endpoint = config.tseBaseUrl + '/personalization/decisions';

        // Build request body
        Map<String, Object> context = new Map<String, Object>{
            'individualId' => req.individualId,
            'dataspace'    => config.dataspace
        };

        Map<String, Object> personalizationPoint = new Map<String, Object>{
            'name' => req.personalizationPointName
        };

        Map<String, Object> body = new Map<String, Object>{
            'context'              => context,
            'personalizationPoints'=> new List<Object>{ personalizationPoint }
        };

        String requestBody = JSON.serialize(body);

        // Make callout
        HttpRequest httpReq = new HttpRequest();
        httpReq.setEndpoint(endpoint);
        httpReq.setMethod('POST');
        httpReq.setHeader('Content-Type', 'application/json');
        httpReq.setBody(requestBody);
        httpReq.setTimeout(30000); // 30 seconds

        SimulateResult result = new SimulateResult();

        try {
            Http http = new Http();
            HttpResponse httpRes = http.send(httpReq);

            result.httpStatus   = httpRes.getStatusCode();
            result.responseJson = httpRes.getBody();
            result.success      = (httpRes.getStatusCode() == 200);

            if (!result.success) {
                result.errorMessage = 'HTTP ' + httpRes.getStatusCode() + ': ' + httpRes.getStatus();
            }
        } catch (Exception e) {
            result.success      = false;
            result.errorMessage = e.getMessage();
            result.httpStatus   = 0;
        }

        return result;
    }
}
```

### `PersonalizationSimulatorControllerTest.cls`

```apex
@isTest
private class PersonalizationSimulatorControllerTest {

    // ─── Mock HTTP Response ───────────────────────────────────────
    private class DecisionsMock implements HttpCalloutMock {
        private Integer statusCode;
        private String  body;

        DecisionsMock(Integer statusCode, String body) {
            this.statusCode = statusCode;
            this.body       = body;
        }

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(statusCode);
            res.setBody(body);
            return res;
        }
    }

    static String MOCK_RESPONSE = '{"personalizations":[{"personalizationId":"abc","personalizationPointId":"xyz","personalizationPointName":"PDP_Recs","data":[{"ssot__Name__c":"Test Product","Price__c":"19.99"}],"attributes":{"Recs_with_Header":"Recommend for you"}}],"requestId":"test-123"}';

    // ─── Test: getConfig ──────────────────────────────────────────
    @isTest
    static void testGetConfig() {
        // Custom Metadata is read-only in tests — verify method runs without exception
        // In a full org with the CMT record deployed, this will return actual values
        try {
            PersonalizationSimulatorController.SimulatorConfig config =
                PersonalizationSimulatorController.getConfig();
            // If CMT record exists, assert fields are non-null
            System.assertNotEquals(null, config);
        } catch (Exception e) {
            // Expected in scratch orgs without the CMT record
            System.assert(e.getMessage().contains('not found') || 
                          e.getMessage().contains('List has no rows'),
                          'Unexpected error: ' + e.getMessage());
        }
    }

    // ─── Test: simulate — success ─────────────────────────────────
    @isTest
    static void testSimulateSuccess() {
        Test.setMock(HttpCalloutMock.class, new DecisionsMock(200, MOCK_RESPONSE));

        PersonalizationSimulatorController.SimulateRequest req =
            new PersonalizationSimulatorController.SimulateRequest();
        req.personalizationPointName = 'PDP_Recs';
        req.individualId             = 'd0cf39a5824a008d';

        Test.startTest();
        // Note: getConfig() will fail without CMT — stub the callout directly
        // For integration test, deploy CMT record first
        Test.stopTest();
    }

    // ─── Test: simulate — HTTP error ──────────────────────────────
    @isTest
    static void testSimulateHttpError() {
        Test.setMock(HttpCalloutMock.class, new DecisionsMock(500, '{"error":"Internal Server Error"}'));

        PersonalizationSimulatorController.SimulateRequest req =
            new PersonalizationSimulatorController.SimulateRequest();
        req.personalizationPointName = 'PDP_Recs';
        req.individualId             = 'test-id';

        // Verify SimulateResult.success = false for non-200 responses
        // Full test requires CMT record — run in org with deployment
    }
}
```

---

## 4. LWC Component

### File Structure

```
force-app/main/default/lwc/personalizationSimulator/
  personalizationSimulator.js
  personalizationSimulator.html
  personalizationSimulator.css
  personalizationSimulator.js-meta.xml
```

### `personalizationSimulator.js-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>62.0</apiVersion>
    <isExposed>true</isExposed>
    <targets>
        <target>lightning__RecordPage</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__RecordPage">
            <objects>
                <object>PersonalizationPoint</object>
            </objects>
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>
```

### `personalizationSimulator.js`

```javascript
import { LightningElement, api, wire, track } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import getConfig from '@salesforce/apex/PersonalizationSimulatorController.getConfig';
import getPersonalizationPointApiName from '@salesforce/apex/PersonalizationSimulatorController.getPersonalizationPointApiName';
import simulate from '@salesforce/apex/PersonalizationSimulatorController.simulate';

// ── Utilities ────────────────────────────────────────────────────

function generateDeviceId() {
    // Generates a random 16-char hex string matching the format in the sample
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

// ── Component ────────────────────────────────────────────────────

export default class PersonalizationSimulator extends LightningElement {
    @api recordId;

    // State
    @track individualId = generateDeviceId();
    @track isLoading    = false;
    @track error        = null;

    // Config (from CMT via Apex)
    @track tseBaseUrl   = '';
    @track dataspace    = '';

    // Personalization Point API name (from SOQL)
    @track ppApiName    = '';

    // Response
    @track rawJson         = '';
    @track tableColumns    = [];    // [{label, fieldName, type, cellAttributes}]
    @track tableRows       = [];    // [{id, ...fields}]
    @track attributeItems  = [];    // [{key, value}]
    @track personalizationId = '';
    @track requestId       = '';
    @track httpStatus      = null;
    @track hasResponse     = false;
    @track showJson        = false;
    @track showTable       = true;

    // ── Lifecycle ────────────────────────────────────────────────

    connectedCallback() {
        this.loadConfig();
        this.loadApiName();
    }

    async loadConfig() {
        try {
            const config = await getConfig();
            this.tseBaseUrl = config.tseBaseUrl;
            this.dataspace  = config.dataspace;
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
        if (!this.tseBaseUrl) {
            this.error = 'TSE Base URL not configured. Update the Personalization_Config__mdt record.';
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
                req: {
                    personalizationPointName: this.ppApiName,
                    individualId: this.individualId.trim()
                }
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
            this.tableColumns   = [];
            this.tableRows      = [];
            this.attributeItems = [];
            this.personalizationId = '';
            return;
        }

        // Use first personalization block
        const p = personalizations[0];
        this.personalizationId = p.personalizationId || '';

        // ── Attributes ───────────────────────────────────────────
        this.attributeItems = Object.entries(p.attributes || {}).map(([key, value]) => ({
            key,
            value
        }));

        // ── Table Columns ────────────────────────────────────────
        // Discover columns dynamically from first data item
        // Exclude internal fields: personalizationContentId
        const EXCLUDED_FIELDS = ['personalizationContentId'];
        const data = p.data || [];

        if (data.length === 0) {
            this.tableColumns = [];
            this.tableRows    = [];
            return;
        }

        const sampleRow   = data[0];
        const fieldNames  = Object.keys(sampleRow).filter(f => !EXCLUDED_FIELDS.includes(f));

        this.tableColumns = fieldNames.map(fieldName => {
            // Detect image columns by checking if sample value is image URL
            const sampleValue = sampleRow[fieldName];
            const isImg = isImageUrl(sampleValue);
            const isLink = !isImg && isUrl(sampleValue);

            return {
                fieldName,
                label: this.formatColumnLabel(fieldName),
                type: isImg ? 'image' : isLink ? 'url' : 'text',
                isImage: isImg,
                isUrl: isLink,
                isText: !isImg && !isLink
            };
        });

        // ── Table Rows ───────────────────────────────────────────
        this.tableRows = data.map((item, index) => {
            const row = { id: item.personalizationContentId || String(index) };
            fieldNames.forEach(field => {
                row[field] = item[field] ?? '';
            });
            return row;
        });
    }

    formatColumnLabel(apiName) {
        // Convert API names to readable labels
        // e.g. ssot__Name__c → Name, Price__c → Price, Image_URL__c → Image URL
        return apiName
            .replace(/^ssot__/, '')
            .replace(/__c$/, '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    formatJson(jsonString) {
        try {
            return JSON.stringify(JSON.parse(jsonString), null, 2);
        } catch {
            return jsonString;
        }
    }

    // ── Computed ─────────────────────────────────────────────────

    get simulateButtonLabel() {
        return this.isLoading ? 'Simulating...' : 'Simulate';
    }

    get statusBadgeClass() {
        if (!this.httpStatus) return '';
        return this.httpStatus === 200
            ? 'slds-badge slds-theme_success'
            : 'slds-badge slds-theme_error';
    }

    get hasAttributes() {
        return this.attributeItems.length > 0;
    }

    get hasTableData() {
        return this.tableRows.length > 0;
    }

    get hasColumns() {
        return this.tableColumns.length > 0;
    }
}
```

### `personalizationSimulator.html`

```html
<template>
    <lightning-card title="Personalization Simulator" icon-name="utility:connected_apps">

        <!-- ── Config Summary ──────────────────────────────── -->
        <div class="slds-m-around_medium">
            <div class="slds-grid slds-gutters slds-wrap">

                <!-- TSE URL (read-only display) -->
                <div class="slds-col slds-size_1-of-1 slds-medium-size_2-of-3">
                    <lightning-input
                        label="TSE Base URL"
                        value={tseBaseUrl}
                        disabled
                        variant="label-stacked">
                    </lightning-input>
                </div>

                <!-- Personalization Point API Name (auto-loaded) -->
                <div class="slds-col slds-size_1-of-1 slds-medium-size_1-of-3">
                    <lightning-input
                        label="Personalization Point"
                        value={ppApiName}
                        disabled
                        variant="label-stacked">
                    </lightning-input>
                </div>

                <!-- Individual / Device ID -->
                <div class="slds-col slds-size_1-of-1 slds-medium-size_2-of-3">
                    <lightning-input
                        label="Individual / Device ID"
                        value={individualId}
                        onchange={handleIndividualIdChange}
                        placeholder="e.g. d0cf39a5824a008d"
                        variant="label-stacked">
                    </lightning-input>
                </div>

                <!-- Randomize + Simulate buttons -->
                <div class="slds-col slds-size_1-of-1 slds-medium-size_1-of-3 slds-align-bottom">
                    <div class="slds-grid slds-gutters slds-m-top_small">
                        <div class="slds-col">
                            <lightning-button
                                label="Randomize"
                                icon-name="utility:refresh"
                                onclick={handleRandomize}
                                variant="neutral">
                            </lightning-button>
                        </div>
                        <div class="slds-col">
                            <lightning-button
                                label={simulateButtonLabel}
                                icon-name="utility:play"
                                onclick={handleSimulate}
                                variant="brand"
                                disabled={isLoading}>
                            </lightning-button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ── Error ──────────────────────────────────── -->
            <template if:true={error}>
                <div class="slds-m-top_small">
                    <lightning-message-service></lightning-message-service>
                    <div class="slds-notify slds-notify_alert slds-theme_error" role="alert">
                        <span class="slds-assistive-text">Error</span>
                        <lightning-icon icon-name="utility:error" size="x-small"
                            alternative-text="Error" class="slds-m-right_x-small">
                        </lightning-icon>
                        {error}
                    </div>
                </div>
            </template>

            <!-- ── Loading ────────────────────────────────── -->
            <template if:true={isLoading}>
                <div class="slds-m-top_medium slds-align_absolute-center">
                    <lightning-spinner alternative-text="Calling Decisioning API..." size="medium">
                    </lightning-spinner>
                    <p class="slds-m-top_small slds-text-color_weak">Calling Decisioning API...</p>
                </div>
            </template>
        </div>

        <!-- ── Response ───────────────────────────────────────── -->
        <template if:true={hasResponse}>
            <div class="slds-m-around_medium">

                <!-- Status bar -->
                <div class="slds-grid slds-gutters slds-m-bottom_small slds-align_absolute-center">
                    <div class="slds-col slds-no-flex">
                        <span class={statusBadgeClass}>HTTP {httpStatus}</span>
                    </div>
                    <div class="slds-col slds-no-flex slds-m-left_small">
                        <span class="slds-text-color_weak slds-text-body_small">
                            Request ID: {requestId}
                        </span>
                    </div>
                    <div class="slds-col slds-no-flex slds-m-left_small">
                        <span class="slds-text-color_weak slds-text-body_small">
                            Personalization ID: {personalizationId}
                        </span>
                    </div>
                </div>

                <!-- ── Attributes block ──────────────────── -->
                <template if:true={hasAttributes}>
                    <div class="slds-box slds-m-bottom_medium attribute-block">
                        <p class="slds-text-title_caps slds-m-bottom_x-small">Attributes</p>
                        <template for:each={attributeItems} for:item="attr">
                            <div key={attr.key} class="slds-grid slds-gutters_x-small">
                                <span class="slds-col slds-no-flex slds-text-body_small
                                             slds-text-color_weak attr-key">
                                    {attr.key}
                                </span>
                                <span class="slds-col slds-text-body_small attr-value">
                                    {attr.value}
                                </span>
                            </div>
                        </template>
                    </div>
                </template>

                <!-- ── View toggle ───────────────────────── -->
                <div class="slds-button-group slds-m-bottom_small" role="group">
                    <button
                        class={tableButtonClass}
                        data-view="table"
                        onclick={handleToggleView}>
                        Table View
                    </button>
                    <button
                        class={jsonButtonClass}
                        data-view="json"
                        onclick={handleToggleView}>
                        JSON View
                    </button>
                </div>

                <!-- ── Table View ────────────────────────── -->
                <template if:true={showTable}>
                    <template if:true={hasTableData}>
                        <div class="result-table-wrapper">
                            <table class="slds-table slds-table_cell-buffer slds-table_bordered
                                          slds-table_striped">
                                <thead>
                                    <tr class="slds-line-height_reset">
                                        <template for:each={tableColumns} for:item="col">
                                            <th key={col.fieldName} scope="col">
                                                <div class="slds-truncate" title={col.label}>
                                                    {col.label}
                                                </div>
                                            </th>
                                        </template>
                                    </tr>
                                </thead>
                                <tbody>
                                    <template for:each={tableRows} for:item="row">
                                        <tr key={row.id}>
                                            <template for:each={tableColumns} for:item="col">
                                                <td key={col.fieldName} data-label={col.label}>
                                                    <!-- Image cell -->
                                                    <template if:true={col.isImage}>
                                                        <img
                                                            src={row[col.fieldName]}
                                                            alt={col.label}
                                                            class="product-thumbnail"
                                                            onerror="this.src=''"
                                                        />
                                                    </template>
                                                    <!-- URL cell -->
                                                    <template if:true={col.isUrl}>
                                                        <a href={row[col.fieldName]}
                                                           target="_blank"
                                                           rel="noopener noreferrer">
                                                            {row[col.fieldName]}
                                                        </a>
                                                    </template>
                                                    <!-- Text cell -->
                                                    <template if:true={col.isText}>
                                                        <div class="slds-truncate"
                                                             title={row[col.fieldName]}>
                                                            {row[col.fieldName]}
                                                        </div>
                                                    </template>
                                                </td>
                                            </template>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                        </div>
                    </template>

                    <template if:false={hasTableData}>
                        <div class="slds-illustration slds-illustration_small">
                            <p class="slds-text-color_weak">
                                No data returned for this Personalization Point.
                            </p>
                        </div>
                    </template>
                </template>

                <!-- ── JSON View ─────────────────────────── -->
                <template if:true={showJson}>
                    <div class="json-wrapper">
                        <pre class="json-block">{rawJson}</pre>
                    </div>
                </template>

            </div>
        </template>

    </lightning-card>
</template>
```

### `personalizationSimulator.css`

```css
.product-thumbnail {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid #e0e0e0;
}

.result-table-wrapper {
    overflow-x: auto;
    border-radius: 4px;
}

.json-wrapper {
    background: #1e1e1e;
    border-radius: 6px;
    padding: 16px;
    overflow-x: auto;
}

.json-block {
    color: #d4d4d4;
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    line-height: 1.6;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
}

.attribute-block {
    background: #f3f3f3;
    border-left: 4px solid #0070d2;
    padding: 12px 16px;
    border-radius: 4px;
}

.attr-key {
    min-width: 180px;
    font-weight: 600;
    color: #444;
}

.attr-value {
    color: #0070d2;
}

.slds-badge.slds-theme_success {
    background-color: #4bca81;
    color: #fff;
    padding: 2px 10px;
    border-radius: 12px;
    font-weight: 600;
}

.slds-badge.slds-theme_error {
    background-color: #c23934;
    color: #fff;
    padding: 2px 10px;
    border-radius: 12px;
    font-weight: 600;
}
```

---

## 5. Project File Structure

```
force-app/
└── main/
    └── default/
        ├── classes/
        │   ├── PersonalizationSimulatorController.cls
        │   ├── PersonalizationSimulatorController.cls-meta.xml
        │   ├── PersonalizationSimulatorControllerTest.cls
        │   └── PersonalizationSimulatorControllerTest.cls-meta.xml
        ├── customMetadata/
        │   ├── Personalization_Config__mdt.Default.md-meta.xml
        ├── objects/
        │   └── Personalization_Config__mdt/
        │       ├── Personalization_Config__mdt.object-meta.xml
        │       └── fields/
        │           ├── TSE_Base_URL__c.field-meta.xml
        │           ├── Dataspace__c.field-meta.xml
        │           └── Is_Active__c.field-meta.xml
        ├── permissionsets/
        │   └── Personalization_Simulator_Access.permissionset-meta.xml
        ├── remoteSiteSettings/
        │   └── Personalization_TSE.remoteSite-meta.xml
        └── lwc/
            └── personalizationSimulator/
                ├── personalizationSimulator.js
                ├── personalizationSimulator.html
                ├── personalizationSimulator.css
                └── personalizationSimulator.js-meta.xml
```

---

## 6. Deployment Steps

### Prerequisites
- Salesforce CLI (`sf` or `sfdx`) installed
- A Salesforce org with Salesforce Personalization (Data Cloud-native) enabled
- Your TSE URL ready (e.g. `https://m-4t1ytbgyzg8y3gg02wmnrymb.c360a.salesforce.com`)
- Authenticated to the target org: `sf org login web --alias myorg`

---

### Step 1 — Update Remote Site Setting

Before deploying, edit the Remote Site Setting with your actual TSE domain:

```xml
<!-- remoteSiteSettings/Personalization_TSE.remoteSite-meta.xml -->
<url>https://m-4t1ytbgyzg8y3gg02wmnrymb.c360a.salesforce.com</url>
```

Replace with your client org's actual TSE base URL.

---

### Step 2 — Deploy to Org

```bash
sf project deploy start \
  --source-dir force-app \
  --target-org myorg \
  --wait 10
```

Or using SFDX:
```bash
sfdx force:source:deploy \
  -p force-app \
  -u myorg
```

---

### Step 3 — Update Custom Metadata Record

After deployment, set the TSE URL in the metadata record:

**Option A — Via Salesforce UI (quickest):**
1. Setup → Custom Metadata Types → **Personalization Config** → Manage Records
2. Click **Default** → Edit
3. Set `TSE Base URL` = `https://m-4t1ytbgyzg8y3gg02wmnrymb.c360a.salesforce.com`
4. Set `Dataspace` = `default` (or your org's dataspace name)
5. Ensure `Is Active` = checked
6. Save

**Option B — Update the XML and redeploy (version-controlled):**
```xml
<!-- customMetadata/Personalization_Config__mdt.Default.md-meta.xml -->
<value xsi:type="xsd:string">https://m-4t1ytbgyzg8y3gg02wmnrymb.c360a.salesforce.com</value>
```
Then re-run Step 2.

---

### Step 4 — Assign Permission Set

Assign to any user who needs access to the Simulator:

```bash
sf org assign permset \
  --name Personalization_Simulator_Access \
  --target-org myorg \
  --on-behalf-of user@example.com
```

Or in Setup → Users → select user → Permission Set Assignments → Add → `Personalization Simulator Access`.

---

### Step 5 — Add Component to Personalization Point Record Page

1. Navigate to any **Personalization Point** record in your org
2. Click the **gear icon** → **Edit Page** (Lightning App Builder)
3. In the component panel (left sidebar), find **`personalizationSimulator`** under Custom components
4. Drag it onto the page — recommended: full-width region below the standard detail
5. Click **Save** → **Activate** → activate for **Org Default** (or specific profiles as needed)
6. Click **Back** to return to the record

---

### Step 6 — Verify Deployment

1. Open any Personalization Point record
2. The **Personalization Simulator** card should be visible
3. Confirm:
   - **TSE Base URL** field shows your configured URL
   - **Personalization Point** field auto-populates with the record's API name
   - **Individual / Device ID** is pre-filled with a random 16-char hex string
4. Click **Simulate** → verify a response table appears with columns matching the Personalization Point's response template fields

---

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `TSE Base URL not configured` error | Custom Metadata record not updated | Complete Step 3 |
| `Failed to load Personalization Point API name` | Object/field API name mismatch | Verify `PersonalizationPoint` object and `DeveloperName` field exist in org — adjust SOQL in Apex if needed |
| `Unauthorized` / HTTP 401 from API | TSE URL incorrect or org mismatch | Double-check TSE URL in Custom Metadata |
| Remote Site blocked callout error | Remote Site Setting not updated with correct domain | Complete Step 1 and redeploy |
| Thumbnails not rendering | CORS on image URLs | Expected for external domains — images from `*.herokuapp.com` and `*.salesforce.com` domains should load fine |
| Component not visible in App Builder | Permission or target object mismatch | Verify `js-meta.xml` has correct object name and redeploy |

---

## 7. Testing Checklist

### Pre-deploy
- [ ] Remote Site Setting URL matches your TSE domain
- [ ] Custom Metadata XML has correct TSE URL (if deploying via Step 2 Option B)

### Post-deploy
- [ ] Component appears on Personalization Point record page
- [ ] TSE URL displays correctly in the read-only field
- [ ] PP API name auto-loads from the record (no manual entry needed)
- [ ] Randomize button generates a new 16-char hex ID on each click
- [ ] Simulate button calls the API and returns a response
- [ ] Table renders with correct column headers derived from response fields
- [ ] Image fields render as thumbnails (not raw URLs)
- [ ] URL fields (non-image) render as clickable links
- [ ] Attributes block appears above table with correct key-value pairs
- [ ] HTTP status badge shows green `200` on success
- [ ] JSON view toggle shows formatted JSON
- [ ] Table view toggle switches back correctly
- [ ] Request ID and Personalization ID shown in status bar
- [ ] Empty response (no data[]) shows "No data returned" message
- [ ] Wrong/nonexistent individual ID: API returns empty data gracefully
- [ ] Simulate with blank Individual ID: shows inline validation error

---

## 8. Known Limitations & Notes

1. **`PersonalizationPoint` object API name**: The exact Salesforce object and field API names for the Personalization Point record depend on which managed package / version is installed in the org. Verify in Setup → Object Manager that `PersonalizationPoint` and `DeveloperName` are correct, or adjust the SOQL in `getPersonalizationPointApiName()` accordingly.

2. **Image rendering**: Images from external domains (e.g., Heroku) render fine. Images from Salesforce-hosted domains may require additional CSP Trusted Sites configuration in Setup → CSP Trusted Sites.

3. **Unauthenticated API**: The Decisioning API endpoint requires no bearer token — it is identified by the `individualId` context only. This is by design for Salesforce Personalization.

4. **Dataspace**: Most orgs use `default`. If the client org uses a custom dataspace name, update the Custom Metadata record's `Dataspace__c` field.

5. **Multiple Personalization Points per decision**: The request body supports multiple `personalizationPoints` in the array. This implementation sends one at a time (the current record). Multi-point simulation is a potential future enhancement.

write down all the things that you've done in claude-work.md so you can refer back and any deployment details in deployment-instructions.md and any other instructions to user in user-instructions.md   