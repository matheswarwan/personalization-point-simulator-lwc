# Claude Context — Personalization Point Simulator LWC

> **Read this at the start of every session before touching any code.**

---

## What This Is

A Lightning Web Component on **Personalization Point record pages** in Salesforce Data Cloud. Lets consultants/TSEs simulate a Personalization Point's decisioning API response for a given visitor and inspect their Data Graph profile — without leaving Salesforce.

**GitHub**: https://github.com/matheswarwan/personalization-point-simulator-lwc  
**Target orgs**:
- `tac-uat` → `mkanagarajan@eigenx.com.uat`
- `sfp13n-plc-2026-v2` → `mathes.kanagarajan@cloudkettle.com.sfp13n.plc.2026.v2`

---

## Project Rules (CLAUDE.MD — always follow)

1. **Discuss + verify before coding** — provide anonymous Apex/SOQL, have user run it, then code
2. **No REST/SOAP Salesforce platform APIs** — prefer ConnectApi, SOQL, internal Apex classes
3. **Zero end-user config** — system must auto-detect everything (TSE URL, data graph, org URL etc.)
4. **No unnecessary custom objects** — cache/reuse; respect governor limits
5. **Always update /docs** — claude-context.md, deployment-instructions.md, design.md
6. **Be direct, no fluff**

---

## Current Feature State

### ✅ Working
- Simulation via TSE decisioning API (`/personalization/decisions`)
- Multi-visitor tabs (up to 10), tabbed results
- Request context fields: requestUrl, pageType, interaction, channel, channelContext, requestTimeZone
- Real visitor IDs from `ssot__WebsiteEngagement__dlm`
- localStorage persistence (TSE URL, context fields, org base URL)
- Per-entry views: Table / Request JSON / Response JSON / Data Graph
- TSE URL auto-restored from localStorage; config reads from `Personalization_Config__mdt`

### ❌ Broken / Incomplete
- **Data Graph profile lookup** — see section below

---

## Data Graph Lookup — Current Status & Decision Pending

### What user wants
"Lookup Profile" button per visitor tab → fetch their realtime Data Graph profile → show as JSON.

### What was tried & why it failed

| Approach | Result |
|----------|--------|
| `ConnectApi.DataCloud.getDataGraphValues()` | Class not visible in this org |
| `ConnectApi.DataCloud.getSettings()` | Class not visible |
| SOQL on `{DataGraphApiName}__dlm` | Object doesn't exist (REALTIME graphs aren't materialized) |
| `FIELDS(ALL)` on `ssot__Individual__dlm` | Not supported on this object |
| `DataGraphDataObject` SOQL | Object not queryable |
| Individual lookup by device ID (`ssot__Id__c = 'd0cf39...'`) | NOT FOUND — device ID ≠ unified Individual ID |

### What we know about the data graph
- DataGraph ID: `0g7hQ00000002BVQAY`
- `DataGraphApiName`: `Realtime_data_graph`
- `DataGraphType`: `REALTIME` (not materialized, computed on demand)
- `PrimaryDmo`: `Individual`
- 2 source objects, 15 fields
- Linked from PersonalizationPoint via `ProfileDataGraphId`

### Only viable path
HTTP callout to org's own Data Cloud REST API:
```
GET {orgBaseUrl}/services/data/v62.0/c360a/dataGraphValues/{dataspace}/{dataGraphApiName}/{individualId}
Authorization: Bearer {sessionId}
```
`orgBaseUrl` = `URL.getSalesforceBaseUrl()` — auto-detected, no config needed.  
**Blocker**: Salesforce requires a Remote Site Setting for HTTP callouts to any URL, including the org's own URL.

### Pending decision (user to answer before next coding session)

**1. Does the device ID work with the Data Graph API?**  
User needs to test in Workbench REST Explorer on tac-uat:
```
GET /services/data/v62.0/c360a/dataGraphValues/default/Realtime_data_graph/d0cf39a5824a008d
```

**2. Which Remote Site approach?**
- **Option A** — Auto-create via `Metadata.Operations.enqueueDeployment()` on first use. Fully automatic. First call fails with "retry shortly", subsequent calls work. Uses native Apex Metadata class.
- **Option B** — Admin sets Remote Site once at deploy time. End users never configure anything. Only `remoteSiteSettings/Org_Self_Callout.remoteSite-meta.xml` needs URL updated before deploy (same pattern as TSE remote site).

---

## Current Apex Controller Methods

```
getConfig()                   — reads Personalization_Config__mdt (TSE URL, dataspace, orgBaseUrl)
getPersonalizationPointApiName(recordId) — SOQL PersonalizationPoint.DeveloperName
getRecentDeviceIds()          — SOQL ssot__WebsiteEngagement__dlm, up to 10 unique IDs
simulate(ppName, indId, tseBaseUrl, dataspace, requestUrl, pageType, interaction, channelContext, channel, requestTimeZone)
getDataGraphValues(recordId, individualId, dataspace, orgBaseUrl) — HTTP callout, BROKEN (Remote Site not configured)
```

## Custom Metadata: `Personalization_Config__mdt`

Fields: `TSE_Base_URL__c`, `Dataspace__c`, `Is_Active__c`, `Org_Base_URL__c`  
Note: `Org_Base_URL__c` was added for data graph but may be removed if we use `URL.getSalesforceBaseUrl()` auto-detection.

## Remote Site Settings

- `Personalization_TSE.remoteSite-meta.xml` — TSE domain (must be updated per org before deploy)
- `Org_Self_Callout.remoteSite-meta.xml` — org My Domain URL (added, placeholder, not yet configured)

---

## LWC State Fields (per-entry)

```js
individualId, source, tabLabel, sourceLabel, sourceBadgeClass
isLoading, hasResult, error
rawJson, rawRequestJson, tableColumns, tableRows, attributeItems
personalizationId, requestId, httpStatus, statusBadgeClass
showTable, showRequest, showJson
dataGraphLoading, dataGraphResult, dataGraphError, showDataGraph  ← Data Graph feature
```

## Global LWC State

```js
tseBaseUrl, dataspace, orgBaseUrl  ← from config + localStorage
ppApiName  ← from getPersonalizationPointApiName
recentIds  ← from getRecentDeviceIds
requestUrl, pageType, interaction, channelContext, channel, requestTimeZone  ← persisted to localStorage
```

---

## Deployed Commits (main branch)

```
675ee74  Fix Data Graph lookup: use REST API for REALTIME graph type
94a4c4f  Add Data Graph profile lookup via DMO SOQL query (wrong approach, superseded)
67ba648  Add Data Graph profile lookup per visitor (initial LWC work)
fc4c4f8  Fix TSE Base URL being overwritten by config on load
94623c7  Show request + response JSON; persist context fields in localStorage
```

## Feature Branch

`feature/data-graph-lookup` — cherry-picked branch, pushed to GitHub for PR review.
