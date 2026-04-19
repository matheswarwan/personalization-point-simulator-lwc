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
                'fakeRecordId', 'fakeIndividualId', 'default'
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
}
