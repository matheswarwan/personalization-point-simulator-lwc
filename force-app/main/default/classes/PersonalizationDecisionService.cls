/**
 * Calls the Personalization decisioning API in one of two modes:
 *
 *  - Unauthenticated: POST {TSE}/personalization/decisions, no Authorization header.
 *  - Authenticated:   for points with IsAuthenticationRequired = true. Tried in order:
 *      1. the standard invocable action getPersonalizationDecisions (runs as the user, no token);
 *      2. a Data Cloud token from the token exchange (/services/a360/token, through the
 *         Named Credential below), sent as Bearer to {TSE}/personalization/authenticated/decisions.
 *
 * The adapters are interfaces so tests can swap them.
 */
public with sharing class PersonalizationDecisionService {

    public static final String MODE_UNAUTHENTICATED = 'Unauthenticated';
    public static final String MODE_AUTHENTICATED   = 'Authenticated';

    // ASSUMPTION: a legacy Named Credential with this name points at the org's own My Domain,
    // authenticates as the running user (OAuth, scopes api + cdp_api + refresh_token) and has
    // "Allow Merge Fields in HTTP Body" on, so {!$Credential.OAuthToken} is the user's access token.
    // See docs/deployment-instructions.md, "Authenticated decisioning".
    public static final String TOKEN_NAMED_CREDENTIAL = 'Personalization_DC_Token';

    // ASSUMPTION: path of the authenticated decisioning endpoint on the tenant (TSE) host,
    // from the Personalization developer guide ("Send an Authenticated Personalization Request").
    public static final String AUTH_DECISIONS_PATH   = '/personalization/authenticated/decisions';
    public static final String UNAUTH_DECISIONS_PATH = '/personalization/decisions';

    // ─── Adapters ─────────────────────────────────────────────────

    public interface ActionInvoker {
        /** Output parameters of getPersonalizationDecisions, or throws. */
        Map<String, Object> invoke(String pointName, Map<String, Object> context);
    }

    public interface TokenProvider {
        /** A Data Cloud access token, or throws. */
        String getToken();
    }

    public class DecisionException extends Exception {}

    // ASSUMPTION: input names from the invocable action reference: persnlPointName and
    // persnlDecisionInputRepresentation (with the request context under "context").
    // Whether a Map is accepted for the representation input is not verified.
    public class StandardActionInvoker implements ActionInvoker {
        public Map<String, Object> invoke(String pointName, Map<String, Object> context) {
            Invocable.Action action = Invocable.Action.createStandardAction('getPersonalizationDecisions');
            action.setInvocationParameter('persnlPointName', pointName);
            action.setInvocationParameter('persnlDecisionInputRepresentation', new Map<String, Object>{ 'context' => context });
            List<Invocable.Action.Result> results = action.invoke();
            if (results == null || results.isEmpty()) {
                throw new DecisionException('The getPersonalizationDecisions action returned nothing.');
            }
            Invocable.Action.Result r = results[0];
            if (!r.isSuccess()) {
                List<String> messages = new List<String>();
                for (Invocable.Action.Error e : r.getErrors()) {
                    messages.add(e.getCode() + ': ' + e.getMessage());
                }
                throw new DecisionException(String.join(messages, '; '));
            }
            return r.getOutputParameters();
        }
    }

    public class NamedCredentialTokenProvider implements TokenProvider {
        public String getToken() {
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:' + TOKEN_NAMED_CREDENTIAL + '/services/a360/token');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            req.setBody(
                'grant_type=urn:salesforce:grant-type:external:cdp'
                + '&subject_token_type=urn:ietf:params:oauth:token-type:access_token'
                + '&subject_token={!$Credential.OAuthToken}'
            );
            req.setTimeout(30000);
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() != 200) {
                throw new DecisionException('Data Cloud token exchange returned HTTP ' + res.getStatusCode() + ': ' + res.getBody());
            }
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            String token = (String) body.get('access_token');
            if (String.isBlank(token)) {
                throw new DecisionException('Data Cloud token exchange returned no access_token.');
            }
            return token;
        }
    }

    @TestVisible private static ActionInvoker actionInvoker = new StandardActionInvoker();
    @TestVisible private static TokenProvider tokenProvider = new NamedCredentialTokenProvider();

    // ─── Result ───────────────────────────────────────────────────

    public class DecisionResult {
        @AuraEnabled public Boolean success;
        @AuraEnabled public Integer httpStatus;
        @AuraEnabled public String  responseJson;
        @AuraEnabled public String  errorMessage;
        @AuraEnabled public String  mode;        // Authenticated | Unauthenticated
        @AuraEnabled public String  modeDetail;  // how the mode was chosen and which path answered
        @AuraEnabled public List<String> notes = new List<String>();
    }

    // ─── Entry point ──────────────────────────────────────────────

    /**
     * authMode: 'auto' (follow the point's IsAuthenticationRequired, and retry authenticated when
     * the unauthenticated endpoint answers 401/403), 'authenticated' or 'unauthenticated'.
     */
    public static DecisionResult decide(
        String pointName, String tseBaseUrl, Map<String, Object> context, String authMode, Boolean requiresAuth
    ) {
        if (String.isBlank(pointName))  throw new DecisionException('Personalization Point API name is required.');
        if (context == null || context.get('individualId') == null || String.isBlank(String.valueOf(context.get('individualId')))) {
            throw new DecisionException('context.individualId is required.');
        }
        if (context.get('dataspace') == null || String.isBlank(String.valueOf(context.get('dataspace')))) {
            context.put('dataspace', 'default');
        }
        String m = String.isBlank(authMode) ? 'auto' : authMode.toLowerCase();

        if (m == 'authenticated' || (m == 'auto' && requiresAuth == true)) {
            DecisionResult r = authenticated(pointName, tseBaseUrl, context);
            r.modeDetail = (m == 'auto' ? 'Point requires authentication. ' : 'Authenticated chosen. ') + r.modeDetail;
            return r;
        }

        DecisionResult r = unauthenticated(pointName, tseBaseUrl, context);
        r.modeDetail = (m == 'auto'
            ? (requiresAuth == null ? 'Point authentication setting unknown. ' : 'Point does not require authentication. ')
            : 'Unauthenticated chosen. ') + r.modeDetail;

        // ASSUMPTION: the org-wide default (point authentication on by default since Spring '25) is
        // not readable through the API; a 401/403 from the public endpoint is taken as that signal.
        if (m == 'auto' && (r.httpStatus == 401 || r.httpStatus == 403)) {
            DecisionResult a = authenticated(pointName, tseBaseUrl, context);
            a.modeDetail = 'Unauthenticated endpoint answered HTTP ' + r.httpStatus + ', retried authenticated. ' + a.modeDetail;
            return a;
        }
        return r;
    }

    // ─── Unauthenticated ──────────────────────────────────────────

    @TestVisible
    private static DecisionResult unauthenticated(String pointName, String tseBaseUrl, Map<String, Object> context) {
        DecisionResult result = new DecisionResult();
        result.mode = MODE_UNAUTHENTICATED;
        result.modeDetail = 'POST ' + UNAUTH_DECISIONS_PATH + ', no token.';
        if (String.isBlank(tseBaseUrl)) {
            result.success = false;
            result.httpStatus = 0;
            result.errorMessage = 'TSE Base URL is required for the decisioning endpoint.';
            return result;
        }
        sendDecision(result, tseBaseUrl.removeEnd('/') + UNAUTH_DECISIONS_PATH, null, pointName, context);
        return result;
    }

    // ─── Authenticated ────────────────────────────────────────────

    @TestVisible
    private static DecisionResult authenticated(String pointName, String tseBaseUrl, Map<String, Object> context) {
        DecisionResult result = new DecisionResult();
        result.mode = MODE_AUTHENTICATED;

        // 1. Standard invocable action: no token, no remote site.
        try {
            Map<String, Object> outputs = actionInvoker.invoke(pointName, context);
            result.success = true;
            result.httpStatus = 200;
            result.responseJson = JSON.serialize(unwrapActionOutput(outputs));
            result.modeDetail = 'Invocable action getPersonalizationDecisions.';
            return result;
        } catch (Exception e) {
            result.notes.add('Invocable action not used: ' + e.getMessage());
        }

        // 2. Token exchange + authenticated endpoint.
        if (String.isBlank(tseBaseUrl)) {
            result.success = false;
            result.httpStatus = 0;
            result.modeDetail = 'No path available.';
            result.errorMessage = 'TSE Base URL is required for the authenticated endpoint.';
            return result;
        }
        String token;
        try {
            token = tokenProvider.getToken();
        } catch (Exception e) {
            result.success = false;
            result.httpStatus = 0;
            result.modeDetail = 'Token exchange failed.';
            result.errorMessage = 'Could not get a Data Cloud token (Named Credential ' + TOKEN_NAMED_CREDENTIAL + '): ' + e.getMessage();
            return result;
        }
        result.modeDetail = 'POST ' + AUTH_DECISIONS_PATH + ' with a Data Cloud token.';
        sendDecision(result, tseBaseUrl.removeEnd('/') + AUTH_DECISIONS_PATH, token, pointName, context);
        return result;
    }

    /**
     * The action's output may be the API response itself or wrap it in one output parameter.
     * ASSUMPTION: output parameter name not verified; a single output is unwrapped, a JSON string
     * output is parsed.
     */
    @TestVisible
    private static Object unwrapActionOutput(Map<String, Object> outputs) {
        if (outputs == null) return new Map<String, Object>();
        Object value = outputs.size() == 1 ? outputs.values()[0] : outputs;
        if (value instanceof String) {
            try { return JSON.deserializeUntyped((String) value); } catch (Exception e) { return value; }
        }
        return value;
    }

    // ─── HTTP ─────────────────────────────────────────────────────

    public static String requestBody(String pointName, Map<String, Object> context) {
        return JSON.serialize(new Map<String, Object>{
            'context'               => context,
            'personalizationPoints' => new List<Object>{ new Map<String, Object>{ 'name' => pointName } }
        });
    }

    private static void sendDecision(DecisionResult result, String endpoint, String token, String pointName, Map<String, Object> context) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        if (token != null) req.setHeader('Authorization', 'Bearer ' + token);
        req.setBody(requestBody(pointName, context));
        req.setTimeout(30000);
        try {
            HttpResponse res = new Http().send(req);
            result.httpStatus   = res.getStatusCode();
            result.responseJson = res.getBody();
            result.success      = res.getStatusCode() == 200;
            if (!result.success) result.errorMessage = 'HTTP ' + res.getStatusCode() + ': ' + res.getStatus();
        } catch (Exception e) {
            result.success      = false;
            result.httpStatus   = 0;
            result.errorMessage = e.getMessage();
        }
    }
}
