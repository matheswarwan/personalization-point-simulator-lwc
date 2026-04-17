# Claude Work Log — Personalization Point Simulator LWC

## Session: 2026-04-16

### What was built

Full implementation of the `personalizationSimulator` LWC component and all supporting Salesforce metadata, based on `docs/design.md`.

---

### Files created

#### Salesforce project config
- `sfdx-project.json` — SFDX project descriptor, API version 62.0

#### Apex
- `force-app/main/default/classes/PersonalizationSimulatorController.cls` — Apex controller with three `@AuraEnabled` methods: `getConfig`, `getPersonalizationPointApiName`, `simulate`
- `force-app/main/default/classes/PersonalizationSimulatorController.cls-meta.xml`
- `force-app/main/default/classes/PersonalizationSimulatorControllerTest.cls` — Test class with HTTP mock
- `force-app/main/default/classes/PersonalizationSimulatorControllerTest.cls-meta.xml`

#### Custom Metadata Type
- `force-app/main/default/objects/Personalization_Config__mdt/Personalization_Config__mdt.object-meta.xml`
- `force-app/main/default/objects/Personalization_Config__mdt/fields/TSE_Base_URL__c.field-meta.xml` — Text(255)
- `force-app/main/default/objects/Personalization_Config__mdt/fields/Dataspace__c.field-meta.xml` — Text(50)
- `force-app/main/default/objects/Personalization_Config__mdt/fields/Is_Active__c.field-meta.xml` — Checkbox
- `force-app/main/default/customMetadata/Personalization_Config__mdt.Default.md-meta.xml` — Default record (TSE URL set to placeholder)

#### Remote Site Setting
- `force-app/main/default/remoteSiteSettings/Personalization_TSE.remoteSite-meta.xml` — Placeholder URL, must be updated before deploy

#### Permission Set
- `force-app/main/default/permissionsets/Personalization_Simulator_Access.permissionset-meta.xml` — Grants Apex class access

#### LWC
- `force-app/main/default/lwc/personalizationSimulator/personalizationSimulator.js` — Component controller
- `force-app/main/default/lwc/personalizationSimulator/personalizationSimulator.html` — Template
- `force-app/main/default/lwc/personalizationSimulator/personalizationSimulator.css` — Styles
- `force-app/main/default/lwc/personalizationSimulator/personalizationSimulator.js-meta.xml` — Targets `lightning__RecordPage` on `PersonalizationPoint` object

---

### Design decisions / fixes vs. design.md

1. **Row/cell data structure redesigned**: LWC templates do not support bracket notation (`row[col.fieldName]`). The design.md had `tableRows` as flat key-value objects. Changed to `tableRows = [{id, cells: [{fieldName, label, value, isImage, isUrl, isText}]}]` so the template can iterate `row.cells` without dynamic property access.

2. **Removed unused imports**: `getRecord` and `wire` were imported in the design.md JS but never used. Removed them.

3. **Added missing computed properties**: `tableButtonClass` and `jsonButtonClass` were referenced in the HTML template but absent from the JS. Added as getters.

4. **Removed invalid `<lightning-message-service>` tag**: The design.md error block included a `<lightning-message-service>` tag inside the error div, which is not a valid UI component — it is a service module. Removed it.

5. **Added `xmlns:xsi` and `xmlns:xsd` to CustomMetadata XML**: Required for the `xsi:type` attributes in `<value>` elements to be valid XML.

---

### Known post-deployment steps required

- Update `Personalization_TSE.remoteSite-meta.xml` with actual TSE domain before deploying
- After deployment, edit `Personalization Config` Custom Metadata record to set the real TSE URL
- Add LWC to the Personalization Point Lightning Record Page via App Builder
- Assign `Personalization_Simulator_Access` permission set to relevant users
- Verify `PersonalizationPoint` object and `DeveloperName` field exist in target org (managed package dependent)
