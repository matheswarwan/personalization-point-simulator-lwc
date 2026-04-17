# Personalization Point Simulator — LWC

A Lightning Web Component that lets Salesforce Personalization implementers fire the Decisioning API directly from a Personalization Point record page — no Postman, no context-switching.

---

## What it does

- **Auto-loads** the Personalization Point API name from the current record
- **Reads config** (TSE URL, dataspace) from a Custom Metadata record — set once, works org-wide
- **Fires the Decisioning API** via Apex callout with a given Individual / Device ID
- **Renders results** as a dynamic table (columns auto-detected from response fields) or formatted JSON
- **Image fields** render as thumbnails; URL fields render as clickable links
- **Attributes block** surfaces key-value pairs (e.g. header text) from the response

---

## Project structure

```
force-app/
└── main/default/
    ├── classes/
    │   ├── PersonalizationSimulatorController.cls
    │   └── PersonalizationSimulatorControllerTest.cls
    ├── customMetadata/
    │   └── Personalization_Config__mdt.Default.md-meta.xml
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
docs/
    ├── design.md              — Full project spec
    ├── deployment-instructions.md
    ├── user-instructions.md
    └── claude-work.md         — Implementation log
```

---

## Prerequisites

- Salesforce org with **Salesforce Personalization (Data Cloud-native)** enabled
- Salesforce CLI (`sf`) installed
- Your org's **TSE Base URL** (e.g. `https://m-xxxx.c360a.salesforce.com`)

---

## Quick deploy

### 1. Update the Remote Site Setting

Edit `force-app/main/default/remoteSiteSettings/Personalization_TSE.remoteSite-meta.xml`:

```xml
<url>https://YOUR-TSE-DOMAIN.c360a.salesforce.com</url>
```

### 2. Deploy

```bash
sf org login web --alias myorg

sf project deploy start \
  --source-dir force-app \
  --target-org myorg \
  --wait 10
```

### 3. Set the TSE URL in Custom Metadata

Setup → Custom Metadata Types → **Personalization Config** → Manage Records → **Default** → Edit → set `TSE Base URL`.

### 4. Assign the permission set

```bash
sf org assign permset \
  --name Personalization_Simulator_Access \
  --target-org myorg \
  --on-behalf-of user@example.com
```

### 5. Add to record page

In Lightning App Builder, drag **`personalizationSimulator`** onto the Personalization Point record page and activate.

---

## Configuration

| Custom Metadata Field | Description | Example |
|---|---|---|
| `TSE_Base_URL__c` | TSE endpoint, no trailing slash | `https://m-xxxx.c360a.salesforce.com` |
| `Dataspace__c` | Personalization dataspace | `default` |
| `Is_Active__c` | Only one record should be active | `true` |

---

## Apex controller methods

| Method | Description |
|---|---|
| `getConfig()` | Returns TSE URL + dataspace from Custom Metadata |
| `getPersonalizationPointApiName(recordId)` | Returns `DeveloperName` from the Personalization Point record |
| `simulate(req)` | Makes the POST callout to `/personalization/decisions` and returns raw JSON + HTTP status |

---

## Notes

- The Decisioning API requires **no bearer token** — authentication is handled by TSE URL + individual ID context
- The `PersonalizationPoint` object API name and `DeveloperName` field depend on the managed package installed in your org — verify in Setup → Object Manager if the component fails to load the API name
- Most orgs use dataspace `default`; update the Custom Metadata record if yours differs
- See [`docs/deployment-instructions.md`](docs/deployment-instructions.md) for full step-by-step deployment guide
- See [`docs/user-instructions.md`](docs/user-instructions.md) for end-user guidance

---

## License

MIT
