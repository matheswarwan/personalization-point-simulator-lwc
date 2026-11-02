@isTest
private class PersonalizationLogLookupTest {

    static Map<String, Object> row(Map<String, Object> m) { return m; }

    @isTest
    static void blankRequestId() {
        PersonalizationLogLookup.LookupResult r = PersonalizationLogLookup.lookup('');
        System.assertEquals(false, r.found);
        System.assert(r.message.contains('no requestId'));
    }

    @isTest
    static void noRowsYet() {
        PersonalizationLogLookup.mockRows = new Map<String, List<Map<String, Object>>>();
        PersonalizationLogLookup.LookupResult r = PersonalizationLogLookup.lookup('req-1');
        System.assertEquals(false, r.found);
        System.assert(r.message.contains('delay'), r.message);
    }

    @isTest
    static void logUnreadable() {
        PersonalizationLogLookup.mockRows = new Map<String, List<Map<String, Object>>>{
            'throw:log' => new List<Map<String, Object>>()
        };
        PersonalizationLogLookup.LookupResult r = PersonalizationLogLookup.lookup('req-1');
        System.assertEquals(false, r.found);
        System.assert(r.message.startsWith('Personalization Log could not be read'), r.message);
    }

    @isTest
    static void decisionWithExperimentCohortAndNames() {
        PersonalizationLogLookup.mockRows = new Map<String, List<Map<String, Object>>>{
            'log' => new List<Map<String, Object>>{ row(new Map<String, Object>{
                'ssot__PersonalizationId__c' => 'pers-1',
                'ssot__PersonalizationDecisionId__c' => '9pbAA0000000001',
                'ssot__PersonalizerId__c' => '0heAA0000000001AAA',
                'ssot__PersonalizationPointId__c' => '9ppAA0000000001',
                'ssot__StatusCode__c' => '200',
                'ssot__RequestDateTime__c' => '2026-11-01T10:00:00.000Z'
            }) },
            'abn' => new List<Map<String, Object>>{
                row(new Map<String, Object>{
                    'ssot__PersonalizationId__c' => 'pers-1',
                    'ssot__AbnExperimentId__c' => '1abAA0000000001',
                    'ssot__AbnExperimentCohortId__c' => '1acAA0000000001',
                    'ssot__TreatmentValueText__c' => 'B'
                }),
                row(new Map<String, Object>{
                    'ssot__PersonalizationId__c' => 'pers-2',
                    'ssot__PersonalizationDecisionId__c' => '9pbAA0000000002',
                    'ssot__AbnExperimentId__c' => '1abAA0000000001',
                    'ssot__AbnExperimentCohortId__c' => '1acAA0000000002'
                })
            },
            'names:PersonalizationDecision' => new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Id' => '9pbAA0000000001AAA', 'Name' => 'Decision A' }) },
            'names:PersonalizationPoint' => new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Id' => '9ppAA0000000001AAA', 'Name' => 'Hero' }) },
            'names:PersonalizationRecommender' => new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Id' => '0heAA0000000001AAA', 'Name' => 'Recs' }) },
            'names:AbnExperiment' => new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Id' => '1abAA0000000001AAA', 'Name' => 'Test 1' }) },
            'names:AbnExperimentCohort' => new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Id' => '1acAA0000000001AAA', 'Name' => 'Variant B', 'IsControl' => false }) },
            'throw:names:Unused' => new List<Map<String, Object>>()
        };
        PersonalizationLogLookup.LookupResult r = PersonalizationLogLookup.lookup('req-1');
        System.assertEquals(true, r.found);
        System.assertEquals(2, r.entries.size());
        PersonalizationLogLookup.LogEntry e = r.entries[0];
        System.assertEquals('Decision A', e.decisionName);
        System.assertEquals('Hero', e.pointName);
        System.assertEquals('Recs', e.personalizerName);
        System.assertEquals('Test 1', e.experimentName);
        System.assertEquals('Variant B', e.cohortName);
        System.assertEquals(false, e.cohortIsControl);
        System.assertEquals('B', e.treatment);
        PersonalizationLogLookup.LogEntry orphan = r.entries[1];
        System.assertEquals('pers-2', orphan.personalizationId);
        System.assertEquals('9pbAA0000000002', orphan.decisionId);
        System.assertEquals(null, orphan.cohortName);
    }

    @isTest
    static void experimentLogMissingAndNameLookupFails() {
        PersonalizationLogLookup.mockRows = new Map<String, List<Map<String, Object>>>{
            'log' => new List<Map<String, Object>>{ row(new Map<String, Object>{
                'ssot__PersonalizationId__c' => 'pers-1',
                'ssot__PersonalizationDecisionId__c' => '9pbAA0000000001'
            }) },
            'throw:abn' => new List<Map<String, Object>>(),
            'throw:names:PersonalizationDecision' => new List<Map<String, Object>>()
        };
        PersonalizationLogLookup.LookupResult r = PersonalizationLogLookup.lookup('req-1');
        System.assertEquals(true, r.found);
        System.assertEquals(1, r.entries.size());
        System.assertEquals(null, r.entries[0].decisionName);
    }

    @isTest
    static void realQueryPathDoesNotThrowUnexpectedly() {
        // Without mocks the DMO query runs for real; in a test org it may fail, which the
        // lookup reports as a message rather than an exception.
        PersonalizationLogLookup.LookupResult r = PersonalizationLogLookup.lookup('req-real');
        System.assertNotEquals(null, r);
    }
}
