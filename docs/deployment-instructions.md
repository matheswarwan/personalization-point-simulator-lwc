# Deployment Instructions — Personalization Point Simulator

## Prerequisites

- Salesforce CLI (`sf` or `sfdx`) installed and on your PATH
- A Salesforce org with **Salesforce Personalization (Data Cloud-native)** enabled
- Your org's **TSE URL** (e.g. `https://m-4t1ytbgyzg8y3gg02wmnrymb.c360a.salesforce.com`)
- Authenticated to the target org:
  ```bash
  sf org login web --alias myorg
  ```

---

## Step 1 — Update Remote Site Setting

Before deploying, edit `force-app/main/default/remoteSiteSettings/Personalization_TSE.remoteSite-meta.xml` and replace the placeholder URL:

```xml
<url>https://YOUR-ACTUAL-TSE-DOMAIN.c360a.salesforce.com</url>
```

Save the file, then proceed to Step 2.

---

## Step 2 — Deploy to Org

```bash
sf project deploy start \
  --source-dir force-app \
  --target-org myorg \
  --wait 10
```

Or using legacy SFDX:
```bash
sfdx force:source:deploy -p force-app -u myorg
```

---

## Step 3 — Configure Custom Metadata Record

After deployment, set the TSE URL in the metadata record.

**Option A — Via Salesforce UI (quickest):**
1. Setup → Custom Metadata Types → **Personalization Config** → Manage Records
2. Click **Default** → Edit
3. Set `TSE Base URL` = your TSE base URL (no trailing slash)
4. Set `Dataspace` = `default` (or your org's dataspace name if different)
5. Ensure `Is Active` = checked
6. Save

**Option B — Update XML and redeploy (version-controlled):**

Edit `force-app/main/default/customMetadata/Personalization_Config__mdt.Default.md-meta.xml`:
```xml
<value xsi:type="xsd:string">https://your-tse-url.c360a.salesforce.com</value>
```
Then re-run Step 2.

---

## Step 4 — Assign Permission Set

Assign to users who need access to the Simulator:

```bash
sf org assign permset \
  --name Personalization_Simulator_Access \
  --target-org myorg \
  --on-behalf-of user@example.com
```

Or in Setup → Users → select user → Permission Set Assignments → Add → **Personalization Simulator Access**.

---

## Step 5 — Add Component to Record Page

1. Navigate to any **Personalization Point** record in your org
2. Click the gear icon → **Edit Page** (Lightning App Builder)
3. In the component panel (left sidebar), find **`personalizationSimulator`** under Custom components
4. Drag it onto the page — recommended: full-width region below the standard detail
5. Click **Save** → **Activate** → activate for **Org Default** (or specific profiles as needed)
6. Click **Back** to return to the record

---

## Step 6 — Verify

1. Open any Personalization Point record
2. The **Personalization Simulator** card should appear
3. Confirm:
   - **TSE Base URL** shows your configured URL
   - **Personalization Point** field auto-populates with the record's API name
   - **Individual / Device ID** is pre-filled with a random 16-char hex string
4. Click **Simulate** → verify a response table appears with columns matching the Personalization Point's response template fields

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `TSE Base URL not configured` | Custom Metadata record not updated | Complete Step 3 |
| `Failed to load Personalization Point API name` | Object/field API name mismatch | Verify `PersonalizationPoint` object and `DeveloperName` field exist in org — adjust SOQL in Apex if needed |
| `Unauthorized` / HTTP 401 from API | TSE URL incorrect or org mismatch | Double-check TSE URL in Custom Metadata |
| Remote Site blocked callout error | Remote Site Setting not updated | Complete Step 1 and redeploy |
| Thumbnails not rendering | CORS on image URLs | Expected for some external domains; images from `*.salesforce.com` should work. For others, add CSP Trusted Sites in Setup |
| Component not visible in App Builder | Permission or target object mismatch | Verify `js-meta.xml` has correct object name and redeploy |
