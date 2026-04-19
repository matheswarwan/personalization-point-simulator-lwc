public with sharing class PersonalizationSimulatorController {

    // ─── Config DTO ───────────────────────────────────────────────
    public class SimulatorConfig {
        @AuraEnabled public String tseBaseUrl;
        @AuraEnabled public String dataspace;
        @AuraEnabled public Boolean autoDetected; // true = came from ConnectApi
    }

    // ─── Response DTO ─────────────────────────────────────────────
    public class SimulateResult {
        @AuraEnabled public Boolean success;
        @AuraEnabled public String responseJson;
        @AuraEnabled public String errorMessage;
        @AuraEnabled public Integer httpStatus;
    }

    // ─── Get Config ───────────────────────────────────────────────
    // Reads TSE URL and dataspace from Personalization_Config__mdt.
    // ConnectApi.DataCloud is not available in this org edition.
    @AuraEnabled(cacheable=true)
    public static SimulatorConfig getConfig() {
        SimulatorConfig result = new SimulatorConfig();

        try {
            Personalization_Config__mdt config = [
                SELECT TSE_Base_URL__c, Dataspace__c
                FROM Personalization_Config__mdt
                WHERE Is_Active__c = true
                LIMIT 1
            ];
            result.tseBaseUrl   = config.TSE_Base_URL__c;
            result.dataspace    = config.Dataspace__c;
            result.autoDetected = false;
        } catch (Exception e) {
            result.tseBaseUrl   = '';
            result.dataspace    = 'default';
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
