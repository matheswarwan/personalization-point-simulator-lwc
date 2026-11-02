public with sharing class PersonalizationSimulatorController {

    // ─── Config DTO ───────────────────────────────────────────────
    public class SimulatorConfig {
        @AuraEnabled public String tseBaseUrl;
        @AuraEnabled public String dataspace;
        @AuraEnabled public Boolean autoDetected; // true = came from ConnectApi
        @AuraEnabled public String orgBaseUrl;    // My Domain URL for Data Graph self-callout
        @AuraEnabled public String apiVersion;    // REST API version for the org's own API calls, e.g. 66.0
    }

    // ─── Response DTO ─────────────────────────────────────────────
    public class SimulateResult {
        @AuraEnabled public Boolean success;
        @AuraEnabled public String responseJson;
        @AuraEnabled public String errorMessage;
        @AuraEnabled public Integer httpStatus;
    }

    // ─── API version ──────────────────────────────────────────────
    // The REST API version for calls to the org's own API (data graph lookup). Set per org in
    // Personalization_Config__mdt.API_Version__c, and per user in the component's settings.
    public static final String DEFAULT_API_VERSION = '66.0';

    /** '66', 'v66.0' or '66.0' -> '66.0'; blank -> the default; anything else throws. */
    public static String normalizeApiVersion(String value) {
        if (String.isBlank(value)) return DEFAULT_API_VERSION;
        String v = value.trim().removeStartIgnoreCase('v');
        if (!Pattern.matches('\\d{2,3}(\\.0)?', v)) {
            throw new AuraHandledException('API version must look like 66.0 (got "' + value + '").');
        }
        return v.contains('.') ? v : v + '.0';
    }

    // ─── Get Config ───────────────────────────────────────────────
    // Reads TSE URL and dataspace from Personalization_Config__mdt.
    // ConnectApi.DataCloud is not available in this org edition.
    @AuraEnabled(cacheable=true)
    public static SimulatorConfig getConfig() {
        SimulatorConfig result = new SimulatorConfig();

        try {
            Personalization_Config__mdt config = [
                SELECT TSE_Base_URL__c, Dataspace__c, Org_Base_URL__c, API_Version__c
                FROM Personalization_Config__mdt
                WHERE Is_Active__c = true
                LIMIT 1
            ];
            result.tseBaseUrl   = config.TSE_Base_URL__c;
            result.dataspace    = config.Dataspace__c;
            result.orgBaseUrl   = config.Org_Base_URL__c;
            result.apiVersion   = normalizeApiVersion(config.API_Version__c);
            result.autoDetected = false;
        } catch (Exception e) {
            result.tseBaseUrl   = '';
            result.dataspace    = 'default';
            result.orgBaseUrl   = '';
            result.apiVersion   = DEFAULT_API_VERSION;
            result.autoDetected = false;
        }

        return result;
    }

    // ─── Get Recent Device IDs from Website Engagement DMO ───────
    // Returns up to 10 unique 16-char individualIds ordered by most recent engagement.
    // 16-char hex strings are the anonymous device IDs set by the Personalization JS SDK.
    @AuraEnabled(cacheable=true)
    public static List<String> getRecentDeviceIds() {
        List<SObject> records = Database.query(
            'SELECT ssot__individualid__c ' +
            'FROM ssot__WebsiteEngagement__dlm ' +
            'WHERE ssot__individualid__c != null ' +
            'ORDER BY ssot__engagementdatetm__c DESC NULLS LAST ' +
            'LIMIT 500'
        );

        Set<String>  seen   = new Set<String>();
        List<String> result = new List<String>();

        for (SObject r : records) {
            String id = (String) r.get('ssot__individualid__c');
            if (id != null && id.length() == 16 && !seen.contains(id)) {
                seen.add(id);
                result.add(id);
                if (result.size() == 10) break;
            }
        }

        return result;
    }

    // ─── Get Personalization Point API Name ───────────────────────
    @AuraEnabled(cacheable=true)
    public static String getPersonalizationPointApiName(String recordId) {
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

    // ─── Data Graph ───────────────────────────────────────────────
    // 1. Resolves ProfileDataGraphId from the PersonalizationPoint
    // 2. Resolves DataGraphApiName from the DataGraph object
    // 3. Queries the Data Graph's values DMO directly via SOQL
    //    (avoids ConnectApi / HTTP callout org-edition requirements)
    @AuraEnabled
    public static String getDataGraphValues(String recordId, String individualId, String dataspace, String orgBaseUrl, String apiVersion) {
        if (String.isBlank(orgBaseUrl)) {
            throw new AuraHandledException(
                'Org Base URL is not configured. Add your org\'s My Domain URL (e.g. https://myorg.my.salesforce.com) to Personalization_Config__mdt and the Org_Self_Callout Remote Site Setting.'
            );
        }

        // Step 1: get linked DataGraph ID
        List<SObject> ppRecs = Database.query(
            'SELECT ProfileDataGraphId FROM PersonalizationPoint WHERE Id = :recordId LIMIT 1'
        );
        if (ppRecs.isEmpty()) {
            throw new AuraHandledException('PersonalizationPoint not found: ' + recordId);
        }
        String dgId = (String) ppRecs[0].get('ProfileDataGraphId');
        if (String.isBlank(dgId)) {
            throw new AuraHandledException('No Data Graph is linked to this Personalization Point.');
        }

        // Step 2: get DataGraphApiName
        List<SObject> dgRecs = Database.query(
            'SELECT DataGraphApiName FROM DataGraph WHERE Id = :dgId LIMIT 1'
        );
        if (dgRecs.isEmpty()) {
            throw new AuraHandledException('DataGraph record not found: ' + dgId);
        }
        String dataGraphApiName = (String) dgRecs[0].get('DataGraphApiName');

        // Step 3: call the Data Cloud REST API on this org
        // Endpoint: GET /services/data/v{apiVersion}/c360a/dataGraphValues/{dataspace}/{dataGraphApiName}/{individualId}
        String ns       = String.isBlank(dataspace) ? 'default' : dataspace;
        String endpoint = orgBaseUrl.removeEnd('/')
            + '/services/data/v' + normalizeApiVersion(apiVersion) + '/c360a/dataGraphValues/'
            + EncodingUtil.urlEncode(ns, 'UTF-8') + '/'
            + EncodingUtil.urlEncode(dataGraphApiName, 'UTF-8') + '/'
            + EncodingUtil.urlEncode(individualId, 'UTF-8');

        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + UserInfo.getSessionId());
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(30000);

        try {
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() == 200) {
                return res.getBody();
            }
            throw new AuraHandledException(
                'Data Graph API returned HTTP ' + res.getStatusCode() + ': ' + res.getBody()
            );
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Data Graph query failed: ' + e.getMessage());
        }
    }

    // ─── Point info ───────────────────────────────────────────────
    public class PointInfo {
        @AuraEnabled public String  apiName;
        @AuraEnabled public Boolean requiresAuth; // null when the field is not available
    }

    // IsAuthenticationRequired checked on PersonalizationPoint (API v66.0). Older API versions
    // may not have it, so a failing query falls back to the name only.
    @AuraEnabled(cacheable=true)
    public static PointInfo getPointInfo(String recordId) {
        PointInfo info = new PointInfo();
        List<SObject> records;
        try {
            records = Database.query(
                'SELECT Id, DeveloperName, IsAuthenticationRequired FROM PersonalizationPoint WHERE Id = :recordId LIMIT 1'
            );
            if (!records.isEmpty()) info.requiresAuth = (Boolean) records[0].get('IsAuthenticationRequired');
        } catch (Exception e) {
            records = Database.query('SELECT Id, DeveloperName FROM PersonalizationPoint WHERE Id = :recordId LIMIT 1');
        }
        if (records.isEmpty()) {
            throw new AuraHandledException('Personalization Point not found for Id: ' + recordId);
        }
        info.apiName = (String) records[0].get('DeveloperName');
        return info;
    }

    // ─── Run decision (auth modes, custom context) ────────────────
    // requestJson: { pointName, tseBaseUrl, authMode: auto|authenticated|unauthenticated,
    //                requiresAuth, context: { individualId, dataspace, ...any keys } }
    @AuraEnabled
    public static PersonalizationDecisionService.DecisionResult runDecision(String requestJson) {
        Map<String, Object> req;
        try {
            req = (Map<String, Object>) JSON.deserializeUntyped(requestJson);
        } catch (Exception e) {
            throw new AuraHandledException('Request is not valid JSON: ' + e.getMessage());
        }
        Object ctx = req.get('context');
        Map<String, Object> context = ctx instanceof Map<String, Object>
            ? (Map<String, Object>) ctx
            : new Map<String, Object>();
        try {
            return PersonalizationDecisionService.decide(
                (String) req.get('pointName'),
                (String) req.get('tseBaseUrl'),
                context,
                (String) req.get('authMode'),
                (Boolean) req.get('requiresAuth')
            );
        } catch (PersonalizationDecisionService.DecisionException e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Decision log lookup ──────────────────────────────────────
    @AuraEnabled
    public static PersonalizationLogLookup.LookupResult lookupDecisionLog(String requestId) {
        return PersonalizationLogLookup.lookup(requestId);
    }

    // ─── Simulate ─────────────────────────────────────────────────
    // tseBaseUrl is passed explicitly so the user's in-place edit is always used
    @AuraEnabled
    public static SimulateResult simulate(
        String personalizationPointName,
        String individualId,
        String tseBaseUrl,
        String dataspace,
        String requestUrl,
        String pageType,
        String interaction,
        String channelContext,
        String channel,
        String requestTimeZone
    ) {
        String endpoint = tseBaseUrl.removeEnd('/') + '/personalization/decisions';

        Map<String, Object> context = new Map<String, Object>{
            'individualId' => individualId,
            'dataspace'    => String.isNotBlank(dataspace) ? dataspace : 'default'
        };

        if (String.isNotBlank(requestUrl))      context.put('requestUrl',                requestUrl);
        if (String.isNotBlank(pageType))        context.put('pageType',                  pageType);
        if (String.isNotBlank(interaction))     context.put('interaction',               interaction);
        if (String.isNotBlank(channel))         context.put('channel',                   channel);
        if (String.isNotBlank(channelContext))  context.put('channelContext',            channelContext);
        if (String.isNotBlank(requestTimeZone)) context.put('p13n_sys_requestTimeZone',  requestTimeZone);

        Map<String, Object> personalizationPoint = new Map<String, Object>{
            'name' => personalizationPointName
        };

        Map<String, Object> body = new Map<String, Object>{
            'context'               => context,
            'personalizationPoints' => new List<Object>{ personalizationPoint }
        };

        HttpRequest httpReq = new HttpRequest();
        httpReq.setEndpoint(endpoint);
        httpReq.setMethod('POST');
        httpReq.setHeader('Content-Type', 'application/json');
        httpReq.setBody(JSON.serialize(body));
        httpReq.setTimeout(30000);

        SimulateResult result = new SimulateResult();

        try {
            HttpResponse httpRes = new Http().send(httpReq);
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
