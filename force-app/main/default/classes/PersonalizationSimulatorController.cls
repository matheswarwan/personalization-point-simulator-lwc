public with sharing class PersonalizationSimulatorController {

    // ─── Config DTO ───────────────────────────────────────────────
    public class SimulatorConfig {
        @AuraEnabled public String tseBaseUrl;
        @AuraEnabled public String dataspace;
    }

    // ─── Response DTO ─────────────────────────────────────────────
    public class SimulateResult {
        @AuraEnabled public Boolean success;
        @AuraEnabled public String responseJson;   // full raw JSON string
        @AuraEnabled public String errorMessage;
        @AuraEnabled public Integer httpStatus;
    }

    // ─── Get Config ───────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static SimulatorConfig getConfig() {
        Personalization_Config__mdt config = [
            SELECT TSE_Base_URL__c, Dataspace__c
            FROM Personalization_Config__mdt
            WHERE Is_Active__c = true
            LIMIT 1
        ];

        SimulatorConfig result = new SimulatorConfig();
        result.tseBaseUrl = config.TSE_Base_URL__c;
        result.dataspace  = config.Dataspace__c;
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
    @AuraEnabled
    public static SimulateResult simulate(String personalizationPointName, String individualId) {
        SimulatorConfig config = getConfig();

        String endpoint = config.tseBaseUrl + '/personalization/decisions';

        // Build request body
        Map<String, Object> context = new Map<String, Object>{
            'individualId' => individualId,
            'dataspace'    => config.dataspace
        };

        Map<String, Object> personalizationPoint = new Map<String, Object>{
            'name' => personalizationPointName
        };

        Map<String, Object> body = new Map<String, Object>{
            'context'               => context,
            'personalizationPoints' => new List<Object>{ personalizationPoint }
        };

        String requestBody = JSON.serialize(body);

        // Make callout
        HttpRequest httpReq = new HttpRequest();
        httpReq.setEndpoint(endpoint);
        httpReq.setMethod('POST');
        httpReq.setHeader('Content-Type', 'application/json');
        httpReq.setBody(requestBody);
        httpReq.setTimeout(30000); // 30 seconds

        SimulateResult result = new SimulateResult();

        try {
            Http http = new Http();
            HttpResponse httpRes = http.send(httpReq);

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
