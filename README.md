# Personalization Point Simulator — LWC

A Lightning Web Component that lets Salesforce Personalization implementers fire the Decisioning API directly from a Personalization Point record page — no Postman, no context-switching.

![](<img/p13n simulator .jpg>)

---

## What it does

- **Auto-loads** the Personalization Point API name from the current record — no manual entry
- **Reads config** (TSE URL, dataspace) from Custom Metadata — set once, works org-wide
- **Fires the Decisioning API** via Apex callout with any Individual / Device ID
- **Renders results** as a dynamic table — columns auto-detected from whatever fields the response returns
- **Image fields** render as thumbnails; URL fields render as clickable links
- **Attributes block** surfaces key-value response attributes (e.g. header text)
- **JSON view** shows the full formatted raw API response

| Table View | JSON View |
|---|---|
| ![](<img/p13n simulator - table view.jpg>) | ![](<img/p13n simulator - json view.jpg>) |

---

## Prerequisites

Before you start, make sure you have:

- A Salesforce org with **Salesforce Personalization (Data Cloud-native)** enabled
- **Salesforce CLI** (`sf`) installed — [install guide](https://developer.salesforce.com/tools/salesforcecli)
- Your org's **TSE Base URL** — see [How to find your TSE URL](#how-to-find-your-tse-url) below

---

## How to find your TSE URL

The TSE (Tenant Specific Endpoint) is the base URL for your org's Personalization API.

1. In your Salesforce org, go to **Setup → Data Cloud → Data Cloud Setup** (or search "Data Cloud" in Setup)
2. Under **Tenant Specific Endpoint**, copy the URL — it looks like:
   `https://m-4t1ytbgyzg8y3gg02wmnrymb.c360a.salesforce.com`
3. **No trailing slash** — copy only the base domain

You can also find it in the Personalization app under **Settings → Data Sources → API**.

---

## Deployment

### Step 1 — Clone this repo

```bash
git clone https://github.com/matheswarwan/personalization-point-simulator-lwc.git
cd personalization-point-simulator-lwc
```

### Step 2 — Update the Remote Site Setting

Before deploying, edit `force-app/main/default/remoteSiteSettings/Personalization_TSE.remoteSite-meta.xml` and replace the URL with your org's actual TSE domain:

```xml
<url>https://m-YOUR-TSE-DOMAIN.c360a.salesforce.com</url>
```

> The `<name>` element is **not** included in this file — the name comes from the filename itself.

### Step 3 — Authenticate to your org

```bash
sf org login web --alias myorg
```

### Step 4 — Deploy everything

```bash
sf project deploy start \
  --source-dir force-app \
  --target-org myorg \
  --wait 10
```

### Step 5 — Set the TSE URL in Custom Metadata

The component reads its configuration from a Custom Metadata record. After deploying:

**Option A — Via Salesforce CLI (recommended):**

Edit `force-app/main/default/customMetadata/Personalization_Config__mdt.Default.md-meta.xml` and set your TSE URL:

```xml
<values>
    <field>TSE_Base_URL__c</field>
    <value xsi:type="xsd:string">https://m-YOUR-TSE-DOMAIN.c360a.salesforce.com</value>
</values>
```

Then redeploy just the metadata record:
```bash
sf project deploy start \
  --source-dir force-app/main/default/customMetadata \
  --target-org myorg \
  --wait 10
```

**Option B — Via Salesforce UI:**
1. Setup → Custom Metadata Types → **Personalization Config** → Manage Records
2. Click **Default** → Edit
3. Set **TSE Base URL** = your TSE URL (no trailing slash)
4. Set **Dataspace** = `default` (or your org's dataspace if different)
5. Ensure **Is Active** = checked
6. Save

> **Important:** Only edit the custom fields (TSE Base URL, Dataspace, Is Active). Do **not** change the **Label** or **Personalization Config Name** fields — those must stay as `Default`.

### Step 6 — Assign the permission set

Assign to any non-admin user who needs access:

```bash
sf org assign permset \
  --name Personalization_Simulator_Access \
  --target-org myorg \
  --on-behalf-of user@example.com
```

Or in Salesforce: Setup → Users → select user → Permission Set Assignments → Add → **Personalization Simulator Access**.

### Step 7 — Add the component to the record page

1. Navigate to any **Personalization Point** record in your org
2. Click the **gear icon (⚙️)** → **Edit Page**
3. In the left component panel, scroll to **Custom** → find **`personalizationSimulator`**
4. Drag it onto the page — recommended position: full-width section below the standard detail
5. Click **Save** → **Activate** → **Assign as Org Default** → **Save**
6. Click **Back** to return to the record

### Step 8 — (Optional) Add CSP Trusted Sites for images

If your Personalization Point returns image URLs from external domains (e.g. Heroku), add them as CSP Trusted Sites so thumbnails render correctly:

1. Setup → CSP Trusted Sites → New
2. Name: `HerokuApp` (or any label)
3. URL: `https://*.herokuapp.com`
4. Check **Allow img-src**
5. Save

---

## Configuration reference

| Custom Metadata Field | Description | Example |
|---|---|---|
| `TSE_Base_URL__c` | TSE endpoint — **no trailing slash** | `https://m-xxxx.c360a.salesforce.com` |
| `Dataspace__c` | Personalization dataspace name | `default` |
| `Is_Active__c` | Mark the active config record | `true` |

---

## Project structure

```
force-app/
└── main/default/
    ├── classes/
    │   ├── PersonalizationSimulatorController.cls       — Apex callout + config
    │   └── PersonalizationSimulatorControllerTest.cls   — Test class
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
    │   └── Personalization_TSE.remoteSite-meta.xml      — Update URL before deploying
    └── lwc/
        └── personalizationSimulator/
docs/
    ├── design.md                    — Full project spec
    ├── deployment-instructions.md   — Detailed deployment guide
    └── user-instructions.md         — End-user guide
```

---

## How to use the component

1. Navigate to a **Personalization Point** record
2. The component auto-fills:
   - **TSE Base URL** — from Custom Metadata (read-only)
   - **Personalization Point** — the record's API name (read-only)
   - **Individual / Device ID** — a random 16-char hex string
3. Optionally type a specific visitor/device ID or click **Randomize**
4. Click **Simulate**
5. Read the results:
   - **HTTP 200** (green) = success
   - **Attributes** block = top-level response attributes (e.g. header text)
   - **Table View** = one row per recommended item, columns auto-detected
   - **JSON View** = full raw API response

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `TSE Base URL not configured` | Custom Metadata record has placeholder URL | Complete Step 5 |
| `Failed to load Personalization Point API name` | `PersonalizationPoint` object or `DeveloperName` field not found | Verify object API name in Setup → Object Manager |
| HTTP 400 `individualId is required` | TSE URL misconfigured or wrong dataspace | Double-check TSE URL and dataspace in Custom Metadata |
| HTTP 401 Unauthorized | TSE URL points to wrong org | Confirm TSE URL matches the org you're logged into |
| Remote Site blocked callout | Remote Site Setting not updated | Complete Step 2 and redeploy |
| Images show broken icon | External domain blocked by CSP | Complete Step 8 |
| Component not visible in App Builder | Wrong target object or not deployed | Verify `js-meta.xml` targets `PersonalizationPoint` and redeploy |
| `List has no rows for assignment` | No active Personalization Config metadata record | Ensure `Is_Active__c = true` on the Default record |

---

## Notes

- The Decisioning API requires **no bearer token** — it is identified by the TSE URL and `individualId` only
- Most orgs use dataspace `default` — update the Custom Metadata record if yours differs
- The `PersonalizationPoint` object and `DeveloperName` field depend on the managed package version in your org — verify in Setup → Object Manager if the API name fails to load

---

## License

MIT
