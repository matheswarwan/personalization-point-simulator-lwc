@isTest
private class PersonalizationDecisionServiceTest {

    static final String TSE = 'https://tenant.example.c360a.salesforce.com';
    static final String OK_BODY = '{"personalizations":[{"personalizationId":"p1","data":[]}],"requestId":"r1"}';

    // Answers by path: /personalization/decisions, /personalization/authenticated/decisions, /services/a360/token.
    private class RoutingMock implements HttpCalloutMock {
        Integer unauthStatus;
        Integer authStatus;
        Integer tokenStatus;
        String  tokenBody;
        public List<HttpRequest> requests = new List<HttpRequest>();
        RoutingMock(Integer unauthStatus, Integer authStatus) {
            this.unauthStatus = unauthStatus;
            this.authStatus   = authStatus;
            this.tokenStatus  = 200;
            this.tokenBody    = '{"access_token":"dc-token","instance_url":"tenant.example"}';
        }
        public HttpResponse respond(HttpRequest req) {
            requests.add(req);
            HttpResponse res = new HttpResponse();
            String ep = req.getEndpoint();
            if (ep.endsWith('/services/a360/token')) {
                res.setStatusCode(tokenStatus);
                res.setBody(tokenBody);
            } else if (ep.endsWith(PersonalizationDecisionService.AUTH_DECISIONS_PATH)) {
                res.setStatusCode(authStatus);
                res.setBody(OK_BODY);
            } else {
                res.setStatusCode(unauthStatus);
                res.setBody(unauthStatus == 200 ? OK_BODY : '{"error":"denied"}');
            }
            return res;
        }
    }

    private class StubInvoker implements PersonalizationDecisionService.ActionInvoker {
        Boolean fail;
        Map<String, Object> outputs;
        StubInvoker(Boolean fail, Map<String, Object> outputs) { this.fail = fail; this.outputs = outputs; }
        public Map<String, Object> invoke(String pointName, Map<String, Object> context) {
            if (fail) throw new PersonalizationDecisionService.DecisionException('action not available');
            return outputs;
        }
    }

    private class StubToken implements PersonalizationDecisionService.TokenProvider {
        Boolean fail;
        StubToken(Boolean fail) { this.fail = fail; }
        public String getToken() {
            if (fail) throw new PersonalizationDecisionService.DecisionException('no named credential');
            return 'dc-token';
        }
    }

    static Map<String, Object> ctx() {
        return new Map<String, Object>{ 'individualId' => 'abc123', 'productId' => 'SKU-1' };
    }

    @isTest
    static void unauthenticatedWhenPointDoesNotRequireAuth() {
        RoutingMock mock = new RoutingMock(200, 200);
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        PersonalizationDecisionService.DecisionResult r = PersonalizationDecisionService.decide('PP', TSE + '/', ctx(), 'auto', false);
        Test.stopTest();
        System.assertEquals(true, r.success);
        System.assertEquals(PersonalizationDecisionService.MODE_UNAUTHENTICATED, r.mode);
        System.assert(r.modeDetail.startsWith('Point does not require authentication.'), r.modeDetail);
        HttpRequest sent = mock.requests[0];
        System.assertEquals(TSE + '/personalization/decisions', sent.getEndpoint());
        System.assertEquals(null, sent.getHeader('Authorization'));
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(sent.getBody());
        Map<String, Object> context = (Map<String, Object>) body.get('context');
        System.assertEquals('SKU-1', context.get('productId'));
        System.assertEquals('default', context.get('dataspace'));
    }

    @isTest
    static void authenticatedUsesInvocableActionFirst() {
        PersonalizationDecisionService.actionInvoker = new StubInvoker(false, new Map<String, Object>{
            'persnlDecisionOutputRepresentation' => OK_BODY
        });
        PersonalizationDecisionService.DecisionResult r = PersonalizationDecisionService.decide('PP', TSE, ctx(), 'auto', true);
        System.assertEquals(true, r.success);
        System.assertEquals(PersonalizationDecisionService.MODE_AUTHENTICATED, r.mode);
        System.assert(r.modeDetail.contains('Invocable action'), r.modeDetail);
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(r.responseJson);
        System.assertEquals('r1', parsed.get('requestId'));
    }

    @isTest
    static void authenticatedFallsBackToTokenAndAuthEndpoint() {
        PersonalizationDecisionService.actionInvoker = new StubInvoker(true, null);
        PersonalizationDecisionService.tokenProvider = new StubToken(false);
        RoutingMock mock = new RoutingMock(401, 200);
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        PersonalizationDecisionService.DecisionResult r = PersonalizationDecisionService.decide('PP', TSE, ctx(), 'authenticated', false);
        Test.stopTest();
        System.assertEquals(true, r.success);
        System.assertEquals(PersonalizationDecisionService.MODE_AUTHENTICATED, r.mode);
        System.assertEquals(1, r.notes.size());
        System.assertEquals(TSE + PersonalizationDecisionService.AUTH_DECISIONS_PATH, mock.requests[0].getEndpoint());
        System.assertEquals('Bearer dc-token', mock.requests[0].getHeader('Authorization'));
    }

    @isTest
    static void autoRetriesAuthenticatedAfter401() {
        PersonalizationDecisionService.actionInvoker = new StubInvoker(true, null);
        PersonalizationDecisionService.tokenProvider = new StubToken(false);
        RoutingMock mock = new RoutingMock(401, 200);
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        PersonalizationDecisionService.DecisionResult r = PersonalizationDecisionService.decide('PP', TSE, ctx(), null, null);
        Test.stopTest();
        System.assertEquals(true, r.success);
        System.assertEquals(PersonalizationDecisionService.MODE_AUTHENTICATED, r.mode);
        System.assert(r.modeDetail.startsWith('Unauthenticated endpoint answered HTTP 401'), r.modeDetail);
        System.assertEquals(2, mock.requests.size());
    }

    @isTest
    static void explicitUnauthenticatedDoesNotRetry() {
        RoutingMock mock = new RoutingMock(403, 200);
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        PersonalizationDecisionService.DecisionResult r = PersonalizationDecisionService.decide('PP', TSE, ctx(), 'unauthenticated', true);
        Test.stopTest();
        System.assertEquals(false, r.success);
        System.assertEquals(403, r.httpStatus);
        System.assertEquals(PersonalizationDecisionService.MODE_UNAUTHENTICATED, r.mode);
        System.assert(r.modeDetail.startsWith('Unauthenticated chosen.'), r.modeDetail);
        System.assertEquals(1, mock.requests.size());
    }

    @isTest
    static void tokenFailureIsReported() {
        PersonalizationDecisionService.actionInvoker = new StubInvoker(true, null);
        PersonalizationDecisionService.tokenProvider = new StubToken(true);
        PersonalizationDecisionService.DecisionResult r = PersonalizationDecisionService.decide('PP', TSE, ctx(), 'authenticated', null);
        System.assertEquals(false, r.success);
        System.assert(r.errorMessage.contains(PersonalizationDecisionService.TOKEN_NAMED_CREDENTIAL), r.errorMessage);
    }

    @isTest
    static void missingTseUrl() {
        PersonalizationDecisionService.actionInvoker = new StubInvoker(true, null);
        PersonalizationDecisionService.DecisionResult a = PersonalizationDecisionService.decide('PP', '', ctx(), 'authenticated', null);
        System.assertEquals(false, a.success);
        PersonalizationDecisionService.DecisionResult u = PersonalizationDecisionService.decide('PP', null, ctx(), 'unauthenticated', null);
        System.assertEquals(false, u.success);
        System.assertEquals(0, u.httpStatus);
    }

    @isTest
    static void validatesInputs() {
        Boolean threw = false;
        try { PersonalizationDecisionService.decide('', TSE, ctx(), 'auto', false); } catch (PersonalizationDecisionService.DecisionException e) { threw = true; }
        System.assert(threw, 'blank point name should throw');
        threw = false;
        try { PersonalizationDecisionService.decide('PP', TSE, new Map<String, Object>(), 'auto', false); } catch (PersonalizationDecisionService.DecisionException e) { threw = true; }
        System.assert(threw, 'missing individualId should throw');
    }

    private class ThrowingMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            throw new CalloutException('Read timed out');
        }
    }

    @isTest
    static void calloutExceptionIsCaught() {
        Test.setMock(HttpCalloutMock.class, new ThrowingMock());
        PersonalizationDecisionService.DecisionResult r = PersonalizationDecisionService.decide('PP', TSE, ctx(), 'unauthenticated', null);
        System.assertEquals(false, r.success);
        System.assertEquals(0, r.httpStatus);
        System.assertNotEquals(null, r.errorMessage);
    }

    @isTest
    static void namedCredentialTokenProvider() {
        RoutingMock mock = new RoutingMock(200, 200);
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        String token = new PersonalizationDecisionService.NamedCredentialTokenProvider().getToken();
        Test.stopTest();
        System.assertEquals('dc-token', token);
        HttpRequest sent = mock.requests[0];
        System.assertEquals('callout:' + PersonalizationDecisionService.TOKEN_NAMED_CREDENTIAL + '/services/a360/token', sent.getEndpoint());
        System.assert(sent.getBody().contains('grant_type=urn:salesforce:grant-type:external:cdp'));
    }

    @isTest
    static void namedCredentialTokenProviderErrors() {
        RoutingMock mock = new RoutingMock(200, 200);
        mock.tokenStatus = 400;
        Test.setMock(HttpCalloutMock.class, mock);
        Boolean threw = false;
        try { new PersonalizationDecisionService.NamedCredentialTokenProvider().getToken(); } catch (PersonalizationDecisionService.DecisionException e) { threw = true; }
        System.assert(threw, 'HTTP 400 should throw');

        mock.tokenStatus = 200;
        mock.tokenBody = '{"token_type":"Bearer"}';
        threw = false;
        try { new PersonalizationDecisionService.NamedCredentialTokenProvider().getToken(); } catch (PersonalizationDecisionService.DecisionException e) { threw = true; }
        System.assert(threw, 'missing access_token should throw');
    }

    @isTest
    static void standardActionInvokerFailsCleanly() {
        // The real action cannot run in Apex tests: invoke says so instead of failing inside Salesforce.
        Boolean threw = false;
        try { new PersonalizationDecisionService.StandardActionInvoker().invoke('PP', ctx()); } catch (PersonalizationDecisionService.DecisionException e) { threw = true; }
        System.assert(threw, 'invoke refuses to run in tests');
    }

    @isTest
    static void unwrapActionOutput() {
        System.assertEquals(0, ((Map<String, Object>) PersonalizationDecisionService.unwrapActionOutput(null)).size());
        Map<String, Object> two = new Map<String, Object>{ 'a' => 1, 'b' => 2 };
        System.assertEquals(two, PersonalizationDecisionService.unwrapActionOutput(two));
        System.assertEquals('not json', PersonalizationDecisionService.unwrapActionOutput(new Map<String, Object>{ 'x' => 'not json' }));
    }
}
