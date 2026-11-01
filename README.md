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
- **Authenticated or public endpoint**: follows the point's "Requires authentication" setting (`IsAuthenticationRequired`), or you pick one. Every result says which mode answered and how it was chosen
- **Decision context**: add any key/value pairs to the request context, for example a product ID for a recommender's dynamic context filter
- **What answered**: shows decision, experiment and cohort fields found in the response, and **Look up in logs** reads the Personalization Log and A/B Experiment Log for the request to name the decision, personalizer, experiment and cohort
- **Compare**: two visitors' responses side by side, with differing values highlighted
- **Template preview** (optional): paste the point's Handlebars template and see the response rendered in a sandboxed frame

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

### Step 7b: (Optional) Authenticated decisioning

Points with **Requires authentication** turned on only answer on the authenticated endpoint. The simulator tries two ways, in this order:

1. **The standard invocable action `getPersonalizationDecisions`** (API 63.0 and later). It runs as the signed-in user, needs no token and no setup. If your org accepts the request this way, you are done.
2. **A Data Cloud token** sent to `{TSE}/personalization/authenticated/decisions`. The Apex gets the token from the Data Cloud token exchange (`/services/a360/token`) through a Named Credential named `Personalization_DC_Token`. Set it up once:
   1. Create a Connected App (or External Client App) with OAuth enabled, scopes **Manage user data via APIs (api)**, **Perform ANSI SQL queries on Data Cloud data (cdp_query_api)** or **Data Cloud API (cdp_api)**, and **Perform requests at any time (refresh_token)**. Callback URL: the one the Auth Provider shows in the next step.
   2. Setup > Auth. Providers > New, type **Salesforce**, with the Connected App's consumer key and secret. Copy its Callback URL back into the Connected App.
   3. Setup > Named Credentials > New Legacy: Label and Name `Personalization_DC_Token`, URL `https://YOUR-DOMAIN.my.salesforce.com`, Identity Type **Per User** (or Named Principal for a shared test user), Authentication Protocol **OAuth 2.0**, the Auth Provider from step 2, Scope `api cdp_api refresh_token`, tick **Allow Merge Fields in HTTP Body**, tick **Start Authentication Flow on Save**.
   4. For Per User: each user authenticates once under their personal settings, **Authentication Settings for External Systems**.

   The TSE Remote Site Setting from Step 2 already covers the authenticated endpoint. Callouts through a Named Credential need no Remote Site Setting.

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
    │   ├── PersonalizationSimulatorControllerTest.cls   — Test class
    │   ├── PersonalizationDecisionService.cls(+Test)    : auth modes, token exchange, invocable action
    │   └── PersonalizationLogLookup.cls(+Test)          : decision and cohort from the log DMOs
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
   - The badge next to the request ID says **Authenticated** or **Unauthenticated**; the line under it says why (point setting, your choice, or a retry after the public endpoint answered 401/403) and which path answered
6. **Decisioning endpoint**: Auto follows the point's setting; pick Authenticated or Unauthenticated to force one
7. **Decision Context**: Add key, then a key and a value. Values that look like JSON (`{...}` or `[...]`) are sent as JSON. `individualId` and `dataspace` are set by the simulator and ignored here
8. **What answered**: after a run, click **Look up in logs**. Logs arrive several minutes after the request, so try again if it says no rows yet
9. **Compare**: with two or more results, pick Visitor A and Visitor B. Only differences is on by default; request and personalization IDs that change on every call are ignored
10. **Experience template**: paste a template, run, then open the **Preview** view of a result. Supported: `{{var}}` (escaped), `{{{var}}}` (raw), `#if`, `#unless`, `#each` (with `@index`, `@key`, `@first`, `@last`), `#with`, `else`, `../` and `this`. The data is the first personalization of the response (`data`, `attributes`) plus `personalizations` and `requestId`. The frame runs no scripts

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `TSE Base URL not configured` | Custom Metadata record has placeholder URL | Complete Step 5 |
| `Failed to load Personalization Point API name` | `PersonalizationPoint` object or `DeveloperName` field not found | Verify object API name in Setup → Object Manager |
| HTTP 400 `individualId is required` | TSE URL misconfigured or wrong dataspace | Double-check TSE URL and dataspace in Custom Metadata |
| HTTP 401 Unauthorized | TSE URL points to wrong org, or the point requires authentication | Confirm the TSE URL; in Auto mode the simulator retries authenticated after a 401/403 |
| `Could not get a Data Cloud token (Named Credential Personalization_DC_Token)` | Authenticated path without the Named Credential | Complete Step 7b, or check the invocable action note in the result |
| `No log rows for this request yet` | Logs arrive with a delay | Wait a few minutes and click Look up in logs again |
| Preview frame stays blank | Your org's CSP blocks `data:` frames | Open **Rendered HTML** under the frame |
| Remote Site blocked callout | Remote Site Setting not updated | Complete Step 2 and redeploy |
| Images show broken icon | External domain blocked by CSP | Complete Step 8 |
| Component not visible in App Builder | Wrong target object or not deployed | Verify `js-meta.xml` targets `PersonalizationPoint` and redeploy |
| `List has no rows for assignment` | No active Personalization Config metadata record | Ensure `Is_Active__c = true` on the Default record |

---

## Notes

- The public decisioning endpoint (`/personalization/decisions`) needs no bearer token: it is identified by the TSE URL and `individualId`. Points that require authentication need the authenticated endpoint with a Data Cloud token, or the invocable action (Step 7b)
- Most orgs use dataspace `default` — update the Custom Metadata record if yours differs
- The `PersonalizationPoint` object and `DeveloperName` field depend on the managed package version in your org — verify in Setup → Object Manager if the API name fails to load

---

## Tests

- LWC: `npm install`, then `npm test` (Jest through `@salesforce/sfdx-lwc-jest`).
- Apex: `sf apex run test --target-org myorg --class-names PersonalizationSimulatorControllerTest,PersonalizationDecisionServiceTest,PersonalizationLogLookupTest --code-coverage --result-format human`.

---

## License

MIT
