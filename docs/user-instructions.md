# User Instructions — Personalization Point Simulator

## What this component does

The **Personalization Simulator** is a Lightning Web Component placed on Personalization Point record pages. It lets you fire the Salesforce Personalization Decisioning API directly from a record page and see the results in a formatted table or raw JSON — no Postman, no context-switching.

---

## Before you use it

1. **The TSE URL must be configured.** An admin needs to set your org's TSE Base URL in Custom Metadata. If the TSE URL field in the component is blank or shows a placeholder, ask your Salesforce admin to update the `Default` record under:
   > Setup → Custom Metadata Types → Personalization Config → Manage Records

2. **You need the permission set.** If you see "Insufficient Privileges" or the component doesn't load, ask your admin to assign you the **Personalization Simulator Access** permission set.

---

## How to use it

1. Navigate to a **Personalization Point** record
2. The component auto-loads:
   - The **TSE Base URL** from Custom Metadata (read-only)
   - The **Personalization Point** API name from the current record (read-only)
   - A random **Individual / Device ID** (16-char hex)
3. Optionally:
   - Type in a specific **Individual / Device ID** to simulate for a known visitor
   - Click **Randomize** to generate a new random ID
4. Click **Simulate**
5. View results:
   - **Table View** (default) — dynamic columns built from whatever fields the Personalization Point returns; image URLs render as thumbnails; other URLs render as clickable links
   - **JSON View** — the raw formatted API response
   - **Attributes** block (above the table) — any top-level attribute values returned (e.g., header text)
   - **Status bar** — shows HTTP status code, Request ID, and Personalization ID

---

## Understanding the results

| Part | What it shows |
|------|--------------|
| HTTP 200 badge (green) | API call succeeded |
| HTTP 4xx/5xx badge (red) | API returned an error — check TSE URL and dataspace config |
| Attributes block | Key-value pairs from `personalization.attributes` — e.g. header/title text |
| Table | One row per item in `personalization.data[]` — columns are auto-detected |
| "No data returned" message | The API responded but returned no items for this visitor/ID combination |

---

## Common questions

**Why does the Personalization Point field auto-fill?**
The component reads the `DeveloperName` field directly from the current record — no manual entry needed.

**What Individual ID should I use?**
Any 16-char hex string works for testing. Use **Randomize** for anonymous simulation, or paste a real visitor device ID to simulate their experience.

**Can I test multiple Personalization Points?**
Not in one request — this component simulates one point at a time (the current record). Navigate to a different Personalization Point record to test another.

**The table columns look like raw API field names (e.g. `ssot__Name__c`)**
The component auto-formats column labels (removing namespace prefixes and `__c` suffixes), but the raw API name is the source of truth.

**Images aren't loading**
Some external image domains may be blocked by CSP. Ask your admin to add the image domain to Setup → CSP Trusted Sites.
