package store

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/majd/ipatool/v2/pkg/appstore"
	"howett.net/plist"
)

func TestParseGSAStep1ResponseClassifiesActionUnavailable(t *testing.T) {
	body := []byte("This action cannot be completed at this time.")
	_, err := parseGSAStep1Response(403, "text/plain; charset=utf-8", body)
	if err == nil {
		t.Fatal("expected response parsing to fail")
	}

	var responseErr *gsaStep1ResponseError
	if !errors.As(err, &responseErr) {
		t.Fatalf("expected gsaStep1ResponseError, got %T", err)
	}
	if !isGSAActionUnavailable(err) {
		t.Fatal("expected Apple's action-unavailable response to be classified")
	}
	for _, want := range []string{"HTTP 403", "text/plain", "This action cannot be completed at this time"} {
		if !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(want)) {
			t.Errorf("error %q does not include %q", err, want)
		}
	}
}

func TestParseGSAStep1ResponseDoesNotClassifyOtherBodies(t *testing.T) {
	_, err := parseGSAStep1Response(502, "text/html", []byte("upstream gateway error"))
	if err == nil {
		t.Fatal("expected response parsing to fail")
	}
	if isGSAActionUnavailable(err) {
		t.Fatal("generic non-plist response must not trigger ipatool fallback")
	}
}

func TestParseGSAStep1ResponseParsesPlist(t *testing.T) {
	type Response struct {
		Response *GSAStep1Response `plist:"Response"`
	}
	body, err := plist.Marshal(Response{
		Response: &GSAStep1Response{Status: GSAStatus{ErrorCode: -22421}},
	}, plist.XMLFormat)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}

	response, err := parseGSAStep1Response(200, "text/x-xml-plist", body)
	if err != nil {
		t.Fatalf("parse response: %v", err)
	}
	if response.Status.ErrorCode != -22421 {
		t.Fatalf("got error code %d, want -22421", response.Status.ErrorCode)
	}
}

func TestParseGSAStep1ResponseRedactsUnknownBody(t *testing.T) {
	secret := "private-session-token"
	_, err := parseGSAStep1Response(502, "text/html", []byte("<html>token="+secret+"</html>"))
	if err == nil {
		t.Fatal("expected response parsing to fail")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatal("response diagnostics exposed the response body")
	}
}

type authTestAppStore struct {
	appstore.AppStore
	login func(appstore.LoginInput) (appstore.LoginOutput, error)
}

func (client *authTestAppStore) Login(input appstore.LoginInput) (appstore.LoginOutput, error) {
	return client.login(input)
}

type authTestKeychain map[string][]byte

func (keychain authTestKeychain) Get(key string) ([]byte, error) {
	data, exists := keychain[key]
	if !exists {
		return nil, errors.New("key not found")
	}
	return data, nil
}

func (keychain authTestKeychain) Set(key string, data []byte) error {
	keychain[key] = append([]byte(nil), data...)
	return nil
}

func (keychain authTestKeychain) Remove(key string) error {
	delete(keychain, key)
	return nil
}

func TestAppStoreFallbackCompletes2FA(t *testing.T) {
	email := "test@example.invalid"
	loginCalls := 0
	service := &Service{
		keychain: authTestKeychain{},
		appStore: &authTestAppStore{login: func(input appstore.LoginInput) (appstore.LoginOutput, error) {
			loginCalls++
			if input.AuthCode == "" {
				return appstore.LoginOutput{}, appstore.ErrAuthCodeRequired
			}
			if input.AuthCode != "123456" {
				t.Fatalf("unexpected verification code %q", input.AuthCode)
			}
			return appstore.LoginOutput{Account: appstore.Account{Email: email}}, nil
		}},
	}

	response, err := service.loginWithIpatool(email, "test-password", "")
	if err != nil || response == nil || !response.Requires2FA || response.Success {
		t.Fatalf("expected 2FA request, got response=%+v err=%v", response, err)
	}
	pending, err := service.GetPending2FA(email)
	if err != nil {
		t.Fatalf("missing pending context for fallback verification: %v", err)
	}
	if pending.AuthType != "appstore" || pending.CreatedAt.IsZero() {
		t.Fatalf("invalid fallback 2FA context: %+v", pending)
	}

	response, err = service.Verify2FA(email, "test-password", "123456")
	if err != nil || response == nil || !response.Success {
		t.Fatalf("verification failed: response=%+v err=%v", response, err)
	}
	if loginCalls != 2 {
		t.Fatalf("got %d login calls, want the initial request and one verified request", loginCalls)
	}
	if _, err := service.GetPending2FA(email); err == nil {
		t.Fatal("pending context was not cleared after successful verification")
	}
}

func TestGSAStep1Live(t *testing.T) {
	if os.Getenv("IPAGET_TEST_GSA_LIVE") != "1" {
		t.Skip("set IPAGET_TEST_GSA_LIVE=1 to probe GSA Step 1 without a real account")
	}
	t.Setenv("IPAGET_DUMP_GSA_PLIST", "0")
	anisette, err := FetchAnisetteData(GetDefaultAnisetteServers()[0])
	if err != nil {
		t.Fatalf("fetch fresh anisette: %v", err)
	}
	context := NewLoginSession("gsa-connectivity-check@example.invalid", "not-a-real-password")
	context.SetAnisetteOverrides(&AnisetteStored{
		DeviceDescription:  anisette.ClientInfo,
		DeviceSerialNumber: anisette.SRLNO,
		ClientTime:         anisette.ClientTime,
		Locale:             anisette.Locale,
		TimeZone:           anisette.TimeZone,
		LocalUserID:        anisette.MDLU,
		RoutingInfo:        anisette.MDRINFO,
	})
	response, err := context.LoginStep1(canonicalDeviceID(anisette.DeviceID), anisette.MD, anisette.MDM, "")
	if err != nil {
		t.Fatalf("GSA Step 1 probe: %v", err)
	}
	t.Logf("GSA returned a parsed plist: hsc=%d ec=%d", response.Status.StatusCode, response.Status.ErrorCode)
}

func TestGSACredentialsRequireCompleteDeveloperSession(t *testing.T) {
	for _, test := range []struct {
		name  string
		creds *GSACredentials
	}{
		{name: "missing DSID", creds: &GSACredentials{AuthToken: "test-xcode-token", AnisetteData: &AnisetteData{}}},
		{name: "missing developer token", creds: &GSACredentials{DSID: "test-dsid", AnisetteData: &AnisetteData{}}},
		{name: "missing anisette", creds: &GSACredentials{DSID: "test-dsid", AuthToken: "test-xcode-token"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &Service{keychain: authTestKeychain{}}
			if err := service.SaveGSACredentials("test@example.invalid", test.creds); err == nil {
				t.Error("incomplete developer credentials must not be saved")
			}
			payload, err := json.Marshal(test.creds)
			if err != nil {
				t.Fatal(err)
			}
			if err := service.keychain.Set(service.getGSAKey("test@example.invalid"), payload); err != nil {
				t.Fatal(err)
			}
			if _, err := service.GetGSACredentials("test@example.invalid"); err == nil {
				t.Error("incomplete stored developer credentials must not be accepted")
			}
		})
	}
}

func TestNewLoginSessionNormalizesAppleID(t *testing.T) {
	session := NewLoginSession("  Test@Example.INVALID  ", "UnchangedPassword")
	if string(session.UserName) != "test@example.invalid" {
		t.Fatalf("unexpected SRP username %q", session.UserName)
	}
	if string(session.Password) != "UnchangedPassword" {
		t.Fatal("password must not be normalized")
	}
}

func TestGSACPDMatchesIloaderWireFormat(t *testing.T) {
	cpd := GSARequestCPD{
		BootStrap: true, ICSCrec: true, PBE: false, PRKGEN: true,
		Loc: "en_US", SVCT: "iCloud", IMD: "test-md", IMDM: "test-mdm", UDID: "test-device",
		ClientTime: "2026-10-21T00:00:00Z", TimeZone: "UTC", RInfo: 17106176,
	}
	body, err := plist.Marshal(cpd, plist.XMLFormat)
	if err != nil {
		t.Fatal(err)
	}
	var actual map[string]interface{}
	if _, err := plist.Unmarshal(body, &actual); err != nil {
		t.Fatal(err)
	}
	expected := map[string]interface{}{
		"bootstrap": "true", "icscrec": "true", "pbe": "false", "prkgen": "true",
		"loc": "en_US", "svct": "iCloud", "X-Apple-I-MD": "test-md", "X-Apple-I-MD-M": "test-mdm", "X-Mme-Device-Id": "test-device",
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("CPD differs from iloader's wire schema: got %#v, want %#v", actual, expected)
	}
}

func TestGSALoginHeadersMatchIloader(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "https://gsa.apple.com/grandslam/GsService2", nil)
	if err != nil {
		t.Fatal(err)
	}
	setGSALoginHeaders(request, GSAHeaders{XMMEClientInfo: "test-client-info"})
	for header, expected := range map[string]string{
		"Accept": "text/x-xml-plist", "Content-Type": "text/x-xml-plist",
		"X-Apple-App-Info": "com.apple.gs.xcode.auth", "X-Xcode-Version": "27.0 (27A5218g)",
		"X-MMe-Client-Info": "test-client-info",
	} {
		if actual := request.Header.Get(header); actual != expected {
			t.Errorf("%s: got %q, want %q", header, actual, expected)
		}
	}
}

func TestGSALoginPreservesPairedClientIdentity(t *testing.T) {
	session := NewLoginSession("test@example.invalid", "test-password")
	session.SetAnisetteOverrides(&AnisetteStored{DeviceDescription: "paired-client", UserAgent: "paired-agent", GSAServiceURL: gsaServiceURL})
	request, err := http.NewRequest(http.MethodPost, gsaServiceURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	setGSALoginHeaders(request, GSAHeaders{XMMEClientInfo: session.HeaderXMMEClientInfo, UserAgent: session.HeaderUserAgent, ServiceURL: session.HeaderServiceURL})
	if request.UserAgent() != "paired-agent" || request.Header.Get("X-MMe-Client-Info") != "paired-client" {
		t.Fatal("provider client identity was not preserved")
	}
	if session.HeaderServiceURL != gsaServiceURL {
		t.Fatal("lookup service endpoint was lost")
	}
}

func TestGSAErrorPreservesProtocolPhase(t *testing.T) {
	err := &GSAError{Code: -80045, Message: "test-denial", Phase: "init"}
	if !strings.Contains(err.Error(), "GSA init error") || !strings.Contains(err.Error(), "-80045") {
		t.Fatal("GSA diagnostic lost the phase or error code")
	}
}

func TestGSATwoFactorPreservesRegisteredClientProfile(t *testing.T) {
	headers := buildGSATwoFactorHeaders(GSAValidateHeaders{UserAgent: "paired-agent", XMMEClientInfo: "paired-client", XAppleIdentityToken: "fixture-identity", SecurityCode: "123456"})
	for name, value := range map[string]string{
		"User-Agent": "paired-agent", "X-MMe-Client-Info": "paired-client", "Accept": "text/x-xml-plist", "Content-Type": "text/x-xml-plist", "X-Apple-App-Info": "com.apple.gs.xcode.auth", "X-Xcode-Version": "27.0 (27A5218g)", "Security-Code": "123456",
	} {
		if headers.Get(name) != value {
			t.Errorf("2FA header %s lost the registered profile", name)
		}
	}
}
