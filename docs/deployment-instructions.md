# Deployment Instructions — Personalization Point Simulator

## Target Orgs

| Alias | Username | Notes |
|-------|----------|-------|
| `tac-uat` | mkanagarajan@eigenx.com.uat | Primary test org |
| `sfp13n-plc-2026-v2` | mathes.kanagarajan@cloudkettle.com.sfp13n.plc.2026.v2 | Secondary |

---

## Prerequisites

- Salesforce CLI (`sf`) installed and on PATH
- Authenticated: `sf org login web --alias tac-uat`
- Org has **Salesforce Personalization (Data Cloud-native)** enabled

---

## Deploy Command

```bash
sf project deploy start --source-dir force-app --target-org tac-uat
```

To deploy to both orgs:
```bash
sf project deploy start --source-dir force-app --target-org tac-uat
sf project deploy start --source-dir force-app --target-org sfp13n-plc-2026-v2
```

---

## Post-Deploy Configuration (Admin, one-time per org)

### 1. Update TSE Remote Site Setting

**In Salesforce UI**: Setup → Remote Site Settings → `Personalization_TSE` → Edit → update URL to the org's TSE base URL (e.g. `https://m-xxxx.c360a.salesforce.com`)

**OR** update before deploy:
```xml
<!-- force-app/main/default/remoteSiteSettings/Personalization_TSE.remoteSite-meta.xml -->
<url>https://YOUR-ACTUAL-TSE.c360a.salesforce.com</url>
```

### 2. Update Org Self-Callout Remote Site Setting ⚠️ REQUIRED FOR DATA GRAPH

**In Salesforce UI**: Setup → Remote Site Settings → `Org_Self_Callout` → Edit → update URL to the org's My Domain URL (e.g. `https://tac-uat.my.salesforce.com`)

**OR** update before deploy:
```xml
<!-- force-app/main/default/remoteSiteSettings/Org_Self_Callout.remoteSite-meta.xml -->
<url>https://YOUR-ORG.my.salesforce.com</url>
```

> ⚠️ Without this, the "Lookup Profile" (Data Graph) button will fail with a callout error.  
> Note: A fully automatic solution is being investigated — see claude-context.md.

### 3. Update Custom Metadata

Setup → Custom Metadata Types → **Personalization Config** → Manage Records → Default → Edit:

| Field | Value |
|-------|-------|
| TSE Base URL | `https://your-tse.c360a.salesforce.com` |
| Dataspace | `default` (or org-specific) |
| Is Active | ✅ checked |
| Org Base URL | `https://your-org.my.salesforce.com` (same as Remote Site above) |

> Note: `Org Base URL` and `Org_Self_Callout` remote site must match.

### 4. Assign Permission Set

```bash
sf org assign permset --name Personalization_Simulator_Access --target-org tac-uat --on-behalf-of user@example.com
```

Or: Setup → Users → [user] → Permission Set Assignments → Add → **Personalization Simulator Access**

### 5. Add Component to Record Page

1. Open any **Personalization Point** record
2. Gear icon → **Edit Page**
3. Find `personalizationSimulator` under Custom components
4. Drag to full-width region below standard detail
5. Save → Activate → Org Default

---

## Running Tests

```bash
sf apex run test --class-names PersonalizationSimulatorControllerTest --target-org tac-uat --result-format human
```

Expected: all tests pass. Tests wrap Data Cloud SOQL in try/catch since `PersonalizationPoint`, `DataGraph`, `ssot__WebsiteEngagement__dlm` may not exist in orgs without Data Cloud.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| TSE URL field blank | Custom Metadata not set | Step 3 above |
| Data Graph "callout error" | `Org_Self_Callout` Remote Site not updated | Step 2 above |
| Data Graph "Org Base URL not configured" | `Org_Base_URL__c` in custom metadata empty | Step 3 above |
| `PersonalizationPoint not found` | Wrong record context | Ensure component is on a PersonalizationPoint record page |
| `Insufficient Privileges` | Permission set not assigned | Step 4 above |
| Component not in App Builder | API version or object mismatch | Verify `js-meta.xml` target object is `PersonalizationPoint` |
