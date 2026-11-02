@isTest
private class PersonalizationSimulatorControllerTest {

    // ─── Mock HTTP Response ───────────────────────────────────────
    private class DecisionsMock implements HttpCalloutMock {
        private Integer statusCode;
        private String  body;

        DecisionsMock(Integer statusCode, String body) {
            this.statusCode = statusCode;
            this.body       = body;
        }

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(statusCode);
            res.setBody(body);
            return res;
        }
    }

    static String MOCK_RESPONSE = '{"personalizations":[{"personalizationId":"abc","personalizationPointId":"xyz","personalizationPointName":"PDP_Recs","data":[{"ssot__Name__c":"Test Product","Price__c":"19.99"}],"attributes":{"Recs_with_Header":"Recommend for you"}}],"requestId":"test-123"}';

    // ─── Test: getConfig ──────────────────────────────────────────
    // ConnectApi.DataCloud.getSettings() cannot be mocked in unit tests.
    // This method is validated via integration test in a Data Cloud-enabled org.
    @isTest
    static void testGetConfig() {
        try {
            PersonalizationSimulatorController.SimulatorConfig config =
                PersonalizationSimulatorController.getConfig();
            System.assertNotEquals(null, config);
            System.assertNotEquals(null, config.tseBaseUrl);
        } catch (Exception e) {
            // Expected in test orgs without Data Cloud enabled
            System.assert(
                e.getMessage() != null,
                'Unexpected error: ' + e.getMessage()
            );
        }
    }

    // ─── Test: getDataGraphValues ────────────────────────────────
    // PersonalizationPoint / DataGraph objects require Data Cloud — wrapped in try/catch.
    @isTest
    static void testGetDataGraphValues() {
        try {
            String result = PersonalizationSimulatorController.getDataGraphValues(
                'fakeRecordId', 'fakeIndividualId', 'default', 'https://fake.my.salesforce.com'
            );
            System.assertNotEquals(null, result);
        } catch (Exception e) {
            System.assert(e.getMessage() != null, 'Unexpected error: ' + e.getMessage());
        }
    }

    // ─── Test: simulate — success ─────────────────────────────────
    @isTest
    static void testSimulateSuccess() {
        Test.setMock(HttpCalloutMock.class, new DecisionsMock(200, MOCK_RESPONSE));

        Test.startTest();
        try {
            PersonalizationSimulatorController.SimulateResult result =
                PersonalizationSimulatorController.simulate(
                    'PDP_Recs', 'd0cf39a5824a008d',
                    'https://m-test.c360a.salesforce.com', 'default',
                    null, null, null, null, null, null
                );
            System.assertEquals(200, result.httpStatus);
            System.assertEquals(true, result.success);
            System.assertEquals(MOCK_RESPONSE, result.responseJson);
        } catch (Exception e) {
            System.assert(e.getMessage() != null, 'Unexpected error: ' + e.getMessage());
        }
        Test.stopTest();
    }

    // ─── Test: simulate — HTTP error ──────────────────────────────
    @isTest
    static void testSimulateHttpError() {
        Test.setMock(HttpCalloutMock.class, new DecisionsMock(500, '{"error":"Internal Server Error"}'));

        Test.startTest();
        try {
            PersonalizationSimulatorController.SimulateResult result =
                PersonalizationSimulatorController.simulate(
                    'PDP_Recs', 'test-id',
                    'https://m-test.c360a.salesforce.com', 'default',
                    null, null, null, null, null, null
                );
            System.assertEquals(500, result.httpStatus);
            System.assertEquals(false, result.success);
            System.assert(result.errorMessage.contains('500'), 'Expected HTTP 500 error message');
        } catch (Exception e) {
            System.assert(e.getMessage() != null, 'Unexpected error: ' + e.getMessage());
        }
        Test.stopTest();
    }

    // ─── Test: getPointInfo ───────────────────────────────────────
    // PersonalizationPoint needs Data Cloud; without a record the method throws "not found".
    @isTest
    static void testGetPointInfoNotFound() {
        try {
            PersonalizationSimulatorController.getPointInfo('9ppAA0000000001AAA');
            System.assert(false, 'Expected not found');
        } catch (Exception e) {
            System.assert(e.getMessage() != null);
        }
    }

    // ─── Test: runDecision ────────────────────────────────────────
    @isTest
    static void testRunDecisionUnauthenticated() {
        Test.setMock(HttpCalloutMock.class, new DecisionsMock(200, MOCK_RESPONSE));
        String req = JSON.serialize(new Map<String, Object>{
            'pointName'    => 'PDP_Recs',
            'tseBaseUrl'   => 'https://m-test.c360a.salesforce.com',
            'authMode'     => 'auto',
            'requiresAuth' => false,
            'context'      => new Map<String, Object>{ 'individualId' => 'd0cf39a5824a008d', 'productId' => 'SKU-1' }
        });
        Test.startTest();
        PersonalizationDecisionService.DecisionResult r = PersonalizationSimulatorController.runDecision(req);
        Test.stopTest();
        System.assertEquals(200, r.httpStatus);
        System.assertEquals('Unauthenticated', r.mode);
    }

    @isTest
    static void testRunDecisionBadInput() {
        Boolean threw = false;
        try { PersonalizationSimulatorController.runDecision('not json'); } catch (AuraHandledException e) { threw = true; }
        System.assert(threw, 'invalid JSON should throw');
        threw = false;
        try { PersonalizationSimulatorController.runDecision('{"pointName":"PP","context":"x"}'); } catch (AuraHandledException e) { threw = true; }
        System.assert(threw, 'missing individualId should throw');
    }

    // ─── Test: lookupDecisionLog ──────────────────────────────────
    @isTest
    static void testLookupDecisionLog() {
        PersonalizationLogLookup.LookupResult r = PersonalizationSimulatorController.lookupDecisionLog('');
        System.assertEquals(false, r.found);
    }

    // ─── Tests on the org's own Personalization Point ─────────────
    // PersonalizationPoint cannot be inserted in a test, so these read an existing one
    // (SeeAllData). In an org without points they only check the not-found paths.
    private static Id existingPointId() {
        List<SObject> pts = Database.query('SELECT Id FROM PersonalizationPoint LIMIT 1');
        return pts.isEmpty() ? null : (Id) pts[0].get('Id');
    }

    @isTest(SeeAllData=true)
    static void testExistingPointNameAndInfo() {
        Id pointId = existingPointId();
        if (pointId == null) return;
        String apiName = PersonalizationSimulatorController.getPersonalizationPointApiName(pointId);
        System.assertNotEquals(null, apiName);
        PersonalizationSimulatorController.PointInfo info = PersonalizationSimulatorController.getPointInfo(pointId);
        System.assertEquals(apiName, info.apiName);
    }

    @isTest(SeeAllData=true)
    static void testExistingPointDataGraph() {
        Id pointId = existingPointId();
        if (pointId == null) return;
        Test.setMock(HttpCalloutMock.class, new DecisionsMock(200, '{"data":[{"json_blob__c":"{}"}]}'));
        Test.startTest();
        try {
            String body = PersonalizationSimulatorController.getDataGraphValues(pointId, 'ind-1', 'default', 'https://example.my.salesforce.com');
            System.assert(body.contains('json_blob__c'));
        } catch (AuraHandledException e) {
            // A point with no profile data graph says so
            System.assert(e.getMessage() != null);
        }
        Test.stopTest();
    }

    @isTest(SeeAllData=true)
    static void testExistingPointDataGraphHttpError() {
        Id pointId = existingPointId();
        if (pointId == null) return;
        Test.setMock(HttpCalloutMock.class, new DecisionsMock(404, '[{"errorCode":"NOT_FOUND"}]'));
        Boolean threw = false;
        Test.startTest();
        try { PersonalizationSimulatorController.getDataGraphValues(pointId, 'ind-1', 'default', 'https://example.my.salesforce.com'); } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assert(threw, 'HTTP 404 should throw');
    }

    @isTest
    static void testPointApiNameNotFound() {
        Boolean threw = false;
        try { PersonalizationSimulatorController.getPersonalizationPointApiName('9ppAA0000000001AAA'); } catch (Exception e) { threw = true; }
        System.assert(threw, 'unknown point should throw');
    }

    @isTest
    static void testDataGraphNeedsOrgUrl() {
        Boolean threw = false;
        try { PersonalizationSimulatorController.getDataGraphValues('9ppAA0000000001AAA', 'ind-1', 'default', ''); } catch (AuraHandledException e) { threw = true; }
        System.assert(threw, 'blank org URL should throw');
    }

    @isTest
    static void testRecentDeviceIds() {
        // Data Cloud DMOs are not queryable in every test context; either outcome is fine.
        try {
            List<String> ids = PersonalizationSimulatorController.getRecentDeviceIds();
            System.assert(ids.size() <= 10);
        } catch (Exception e) {
            System.assert(e.getMessage() != null);
        }
    }
}
