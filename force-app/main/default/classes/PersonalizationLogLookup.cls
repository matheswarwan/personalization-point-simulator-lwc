/**
 * Which decision, personalizer, experiment and cohort answered a request, from the
 * Personalization Log and A/B Experiment Log DMOs. Logs land with a delay, so the LWC calls
 * this on a button, not right after the request.
 *
 * Field names checked on an org (describe, API v66.0, 2026-11-01).
 */
public with sharing class PersonalizationLogLookup {

    public class LogEntry {
        @AuraEnabled public String requestDateTime;
        @AuraEnabled public String statusCode;
        @AuraEnabled public String personalizationId;
        @AuraEnabled public String pointId;
        @AuraEnabled public String pointName;
        @AuraEnabled public String decisionId;
        @AuraEnabled public String decisionName;
        @AuraEnabled public String personalizerId;
        @AuraEnabled public String personalizerName;
        @AuraEnabled public String experimentId;
        @AuraEnabled public String experimentName;
        @AuraEnabled public String cohortId;
        @AuraEnabled public String cohortName;
        @AuraEnabled public Boolean cohortIsControl;
        @AuraEnabled public String treatment;
    }

    public class LookupResult {
        @AuraEnabled public Boolean found = false;
        @AuraEnabled public String  message;
        @AuraEnabled public List<LogEntry> entries = new List<LogEntry>();
    }

    // Tests put rows here by query key ('log', 'abn', 'names:<Object>') instead of querying.
    @TestVisible private static Map<String, List<Map<String, Object>>> mockRows;

    private static final Pattern RECORD_ID = Pattern.compile('^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$');

    public static LookupResult lookup(String requestId) {
        LookupResult result = new LookupResult();
        if (String.isBlank(requestId)) {
            result.message = 'This response has no requestId to look up.';
            return result;
        }

        List<Map<String, Object>> logRows;
        try {
            logRows = rows('log',
                'SELECT ssot__PersonalizationId__c, ssot__PersonalizationDecisionId__c, ssot__PersonalizerId__c, '
                + 'ssot__PersonalizationPointId__c, ssot__StatusCode__c, ssot__RequestDateTime__c '
                + 'FROM ssot__PersonalizationLog__dlm WHERE ssot__PersonalizationRequestId__c = :requestId LIMIT 20',
                requestId);
        } catch (Exception e) {
            result.message = 'Personalization Log could not be read: ' + e.getMessage();
            return result;
        }

        List<Map<String, Object>> abnRows = new List<Map<String, Object>>();
        try {
            abnRows = rows('abn',
                'SELECT ssot__PersonalizationId__c, ssot__AbnExperimentId__c, ssot__AbnExperimentCohortId__c, '
                + 'ssot__PersonalizationDecisionId__c, ssot__TreatmentValueText__c '
                + 'FROM ssot__AbnExperimentLog__dlm WHERE ssot__Requestid__c = :requestId LIMIT 20',
                requestId);
        } catch (Exception e) {
            // No experiment log (no experiments in the org, or no access): decisions still show.
        }

        if (logRows.isEmpty() && abnRows.isEmpty()) {
            result.message = 'No log rows for this request yet. Logs arrive with a delay of several minutes; try again later.';
            return result;
        }

        Map<String, Map<String, Object>> abnByPersonalization = new Map<String, Map<String, Object>>();
        for (Map<String, Object> a : abnRows) {
            abnByPersonalization.put(str(a, 'ssot__PersonalizationId__c'), a);
        }

        Set<String> ids = new Set<String>();
        for (Map<String, Object> r : logRows) {
            LogEntry e = new LogEntry();
            e.requestDateTime   = str(r, 'ssot__RequestDateTime__c');
            e.statusCode        = str(r, 'ssot__StatusCode__c');
            e.personalizationId = str(r, 'ssot__PersonalizationId__c');
            e.pointId           = str(r, 'ssot__PersonalizationPointId__c');
            e.decisionId        = str(r, 'ssot__PersonalizationDecisionId__c');
            e.personalizerId    = str(r, 'ssot__PersonalizerId__c');
            Map<String, Object> a = abnByPersonalization.remove(e.personalizationId);
            if (a != null) applyAbn(e, a);
            result.entries.add(e);
        }
        // Experiment rows without a matching log row still say which cohort answered.
        for (Map<String, Object> a : abnByPersonalization.values()) {
            LogEntry e = new LogEntry();
            e.personalizationId = str(a, 'ssot__PersonalizationId__c');
            e.decisionId        = str(a, 'ssot__PersonalizationDecisionId__c');
            applyAbn(e, a);
            result.entries.add(e);
        }
        for (LogEntry e : result.entries) {
            for (String id : new List<String>{ e.pointId, e.decisionId, e.personalizerId, e.experimentId, e.cohortId }) {
                if (id != null && RECORD_ID.matcher(id).matches()) ids.add(id);
            }
        }

        Map<String, Map<String, Object>> names = names(ids);
        for (LogEntry e : result.entries) {
            e.pointName        = nameOf(names, e.pointId);
            e.decisionName     = nameOf(names, e.decisionId);
            e.personalizerName = nameOf(names, e.personalizerId);
            e.experimentName   = nameOf(names, e.experimentId);
            e.cohortName       = nameOf(names, e.cohortId);
            Map<String, Object> cohort = byId(names, e.cohortId);
            if (cohort != null && cohort.get('IsControl') != null) e.cohortIsControl = (Boolean) cohort.get('IsControl');
        }
        result.found = true;
        return result;
    }

    private static void applyAbn(LogEntry e, Map<String, Object> a) {
        e.experimentId = str(a, 'ssot__AbnExperimentId__c');
        e.cohortId     = str(a, 'ssot__AbnExperimentCohortId__c');
        e.treatment    = str(a, 'ssot__TreatmentValueText__c');
        if (e.decisionId == null) e.decisionId = str(a, 'ssot__PersonalizationDecisionId__c');
    }

    /** Name (and IsControl for cohorts) of setup records, keyed by 15-character ID. */
    private static Map<String, Map<String, Object>> names(Set<String> ids) {
        Map<String, Map<String, Object>> out = new Map<String, Map<String, Object>>();
        if (ids.isEmpty()) return out;
        List<String> idList = new List<String>(ids);
        Map<String, String> queries = new Map<String, String>{
            'PersonalizationPoint'       => 'SELECT Id, Name FROM PersonalizationPoint WHERE Id IN :idList',
            'PersonalizationDecision'    => 'SELECT Id, Name FROM PersonalizationDecision WHERE Id IN :idList',
            'PersonalizationRecommender' => 'SELECT Id, Name FROM PersonalizationRecommender WHERE Id IN :idList',
            'AbnExperiment'              => 'SELECT Id, Name FROM AbnExperiment WHERE Id IN :idList',
            'AbnExperimentCohort'        => 'SELECT Id, Name, IsControl FROM AbnExperimentCohort WHERE Id IN :idList'
        };
        for (String obj : queries.keySet()) {
            try {
                for (Map<String, Object> r : rows('names:' + obj, queries.get(obj), idList)) {
                    String id = str(r, 'Id');
                    if (id != null) out.put(id.left(15), r);
                }
            } catch (Exception e) {
                // Object missing in this org or no access: the ID is shown without a name.
            }
        }
        return out;
    }

    private static Map<String, Object> byId(Map<String, Map<String, Object>> names, String id) {
        return id == null ? null : names.get(id.left(15));
    }

    private static String nameOf(Map<String, Map<String, Object>> names, String id) {
        Map<String, Object> r = byId(names, id);
        return r == null ? null : str(r, 'Name');
    }

    private static String str(Map<String, Object> r, String field) {
        Object v = r.get(field);
        return v == null ? null : String.valueOf(v);
    }

    /** Runs a query with one bind (`requestId` or `idList`) and returns rows as maps. */
    private static List<Map<String, Object>> rows(String key, String soql, Object bindValue) {
        if (mockRows != null) {
            if (mockRows.containsKey(key)) return mockRows.get(key);
            if (mockRows.containsKey('throw:' + key)) throw new PersonalizationDecisionService.DecisionException('mock failure');
            return new List<Map<String, Object>>();
        }
        Map<String, Object> binds = new Map<String, Object>{ (soql.contains(':requestId') ? 'requestId' : 'idList') => bindValue };
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (SObject s : Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE)) {
            out.add(s.getPopulatedFieldsAsMap());
        }
        return out;
    }
}
