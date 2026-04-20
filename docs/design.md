# Design — Personalization Point Simulator LWC

## Overview

LWC on Personalization Point record pages. Simulates the decisioning API for up to 10 visitors simultaneously and shows their Data Cloud profile from the linked realtime data graph.

---

## Components

### Apex: `PersonalizationSimulatorController`

| Method | Type | Purpose |
|--------|------|---------|
| `getConfig()` | `@AuraEnabled(cacheable=true)` | Reads `Personalization_Config__mdt` → returns TSE URL, dataspace, org base URL |
| `getPersonalizationPointApiName(recordId)` | `@AuraEnabled(cacheable=true)` | SOQL on `PersonalizationPoint.DeveloperName` |
| `getRecentDeviceIds()` | `@AuraEnabled(cacheable=true)` | SOQL on `ssot__WebsiteEngagement__dlm`, returns up to 10 unique 16-char visitor IDs |
| `simulate(10 params)` | `@AuraEnabled` | HTTP callout to TSE `/personalization/decisions`. Params: ppName, individualId, tseBaseUrl, dataspace, requestUrl, pageType, interaction, channelContext, channel, requestTimeZone |
| `getDataGraphValues(recordId, individualId, dataspace, orgBaseUrl)` | `@AuraEnabled` | Resolves ProfileDataGraphId → DataGraphApiName → HTTP GET to org's own Data Cloud REST API |

### DTOs
- `SimulatorConfig` — tseBaseUrl, dataspace, autoDetected, orgBaseUrl
- `SimulateResult` — success, responseJson, errorMessage, httpStatus

---

## Data Graph Feature Design

### Flow
1. User clicks "Lookup Profile" on a visitor tab
2. LWC calls `getDataGraphValues(recordId, individualId, dataspace, orgBaseUrl)`
3. Apex: SOQL `PersonalizationPoint` → `ProfileDataGraphId`
4. Apex: SOQL `DataGraph` → `DataGraphApiName`
5. Apex: HTTP GET `{orgBaseUrl}/services/data/v62.0/c360a/dataGraphValues/{dataspace}/{dataGraphApiName}/{individualId}`
   - Auth: `Bearer {UserInfo.getSessionId()}`
6. Returns raw JSON → displayed in "Data Graph" view tab

### Why HTTP callout (not ConnectApi or SOQL)
- `ConnectApi.DataCloud` — **not available** in target orgs (confirmed via anonymous Apex)
- SOQL on DMO — impossible: `DataGraphType = REALTIME` means data is computed on demand, not materialized in any DMO
- `DataGraphDataObject` — not a queryable SObject in these orgs
- `FIELDS(ALL)` on `ssot__Individual__dlm` — not supported
- Device ID (`d0cf39a5824a008d`) ≠ unified Individual ID in `ssot__Individual__dlm`

### Open issue: Remote Site auto-configuration
**Problem**: HTTP callout to `URL.getSalesforceBaseUrl()` requires a Remote Site Setting for that URL. Remote Sites can't be programmatically created without Metadata Operations (async).

**Option A (zero-config)**: `Metadata.Operations.enqueueDeployment()` — auto-creates Remote Site on first use. Async: first call fails gracefully with "retry shortly", subsequent calls work automatically.

**Option B (admin-once)**: Admin updates `Org_Self_Callout.remoteSite-meta.xml` URL at deploy time. End users never configure anything.

**Pending**: User to decide between A and B. Also pending: verify device ID works with data graph REST API via Workbench (`GET /services/data/v62.0/c360a/dataGraphValues/default/Realtime_data_graph/d0cf39a5824a008d`).

---

## Custom Metadata: `Personalization_Config__mdt`

| Field | Type | Purpose |
|-------|------|---------|
| `TSE_Base_URL__c` | Text(255) | TSE base URL, no trailing slash |
| `Dataspace__c` | Text(50) | Default: `default` |
| `Is_Active__c` | Checkbox | Only one active record per org |
| `Org_Base_URL__c` | Text(255) | Org My Domain URL for data graph self-callout |

> Note: `Org_Base_URL__c` may be removed if we switch to `URL.getSalesforceBaseUrl()` auto-detection + Metadata Operations for Remote Site.

---

## Remote Site Settings

| Name | URL | Purpose |
|------|-----|---------|
| `Personalization_TSE` | `https://YOUR-TSE.c360a.salesforce.com` | TSE decisioning API callout |
| `Org_Self_Callout` | `https://YOUR-ORG.my.salesforce.com` | Data graph self-callout |

---

## LWC Architecture

### Entry model (per visitor tab)
Each visitor is an `entry` object with keys:
- Identity: `individualId`, `source` (random/recent/manual), `sourceLabel`, `sourceBadgeClass`, `tabLabel`
- Simulation state: `isLoading`, `hasResult`, `error`, `httpStatus`, `statusBadgeClass`
- Result data: `rawJson`, `rawRequestJson`, `tableColumns`, `tableRows`, `attributeItems`, `personalizationId`, `requestId`
- View toggles: `showTable`, `showRequest`, `showJson`, `showDataGraph`
- Data Graph state: `dataGraphLoading`, `dataGraphResult`, `dataGraphError`

### localStorage persistence
Key: `p13n_sim_context`  
Fields persisted: `tseBaseUrl`, `orgBaseUrl`, `requestUrl`, `pageType`, `interaction`, `channel`, `channelContext`, `requestTimeZone`

Config from `Personalization_Config__mdt` only fills fields not already in localStorage (config never overwrites user-entered values).

### Config auto-detection aspirations (Rule 3)
- `ppApiName` — auto from record context ✅
- `recentIds` — auto from WebsiteEngagement DMO ✅
- `tseBaseUrl` — currently manual (custom metadata). Original plan: `ConnectApi.DataCloud.getSettings()` — NOT available in these orgs ❌
- `orgBaseUrl` — `URL.getSalesforceBaseUrl()` works in Apex ✅ (only Remote Site setup is the blocker)
- `dataspace` — currently manual. Could potentially be read from org metadata ⚠️

---

## File Structure

```
force-app/main/default/
├── classes/
│   ├── PersonalizationSimulatorController.cls
│   └── PersonalizationSimulatorControllerTest.cls
├── customMetadata/
│   └── Personalization_Config__mdt.Default.md-meta.xml
├── objects/Personalization_Config__mdt/fields/
│   ├── TSE_Base_URL__c.field-meta.xml
│   ├── Dataspace__c.field-meta.xml
│   ├── Is_Active__c.field-meta.xml
│   └── Org_Base_URL__c.field-meta.xml
├── remoteSiteSettings/
│   ├── Personalization_TSE.remoteSite-meta.xml
│   └── Org_Self_Callout.remoteSite-meta.xml
├── permissionsets/
│   └── Personalization_Simulator_Access.permissionset-meta.xml
└── lwc/personalizationSimulator/
    ├── personalizationSimulator.js
    ├── personalizationSimulator.html
    ├── personalizationSimulator.css
    └── personalizationSimulator.js-meta.xml
docs/
├── claude-context.md
├── deployment-instructions.md
├── design.md
├── user-instructions.md
└── Test-data.md
```
