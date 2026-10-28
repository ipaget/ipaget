package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ipaget-service/internal/logger"

	"github.com/99designs/keyring"
	"github.com/majd/ipatool/v2/pkg/appstore"
	"github.com/majd/ipatool/v2/pkg/util/machine"
	"howett.net/plist"
)

type signingTestMachine struct{ machine.Machine }

func (*signingTestMachine) MacAddress() (string, error) { return "00:11:22:33:44:55", nil }

func newSigningTestService(t *testing.T, status *GSAStatus, loginErr error) (*Service, string, *int) {
	t.Helper()
	anisette := AnisetteData{
		ClientTime: time.Now().UTC().Format(time.RFC3339), MD: "test-md", MDM: "test-mdm",
		DeviceID: "test-device", Locale: "en_US", TimeZone: "UTC", MDLU: "test-lu",
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewEncoder(writer).Encode(anisette); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	spd, err := plist.Marshal(map[string]interface{}{
		"adsid": "test-dsid", "GsIdmsToken": "test-idms-token", "sk": make([]byte, 32), "c": []byte("test-challenge"),
	}, plist.XMLFormat)
	if err != nil {
		t.Fatal(err)
	}
	loginCalls := new(int)
	service := &Service{
		keychain: authTestKeychain{}, machine: &signingTestMachine{}, configDir: t.TempDir(),
		gsaLogin: func(username, password, udid, imd, imdm, cid string, stored *AnisetteStored) (*GSAStatus, []byte, error) {
			return status, spd, loginErr
		},
		gsaAppToken: func(spd *SPDData, data *AnisetteData) (string, error) { return "test-xcode-token", nil },
		appStore: &authTestAppStore{login: func(input appstore.LoginInput) (appstore.LoginOutput, error) {
			*loginCalls++
			return appstore.LoginOutput{Account: appstore.Account{Email: input.Email}}, nil
		}},
	}
	if err := service.saveDeviceMetadata("test@example.invalid", &DeviceMetadata{UDID: "test-device", CID: "test-client"}); err != nil {
		t.Fatal(err)
	}
	return service, server.URL, loginCalls
}

func TestSigningRejectsAppStoreFallback(t *testing.T) {
	for _, test := range []struct {
		name   string
		status *GSAStatus
		err    error
	}{
		{name: "plain text denial", err: &gsaStep1ResponseError{actionUnavailable: true}},
		{name: "structured denial", status: &GSAStatus{ErrorCode: -22421, ErrorMessage: "This action cannot be completed at this time"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, endpoint, calls := newSigningTestService(t, test.status, test.err)
			response, err := service.LoginForSigning("test@example.invalid", "test-password", endpoint)
			if err == nil || response != nil && response.Success {
				t.Fatal("App Store fallback must not count as developer authentication")
			}
			if *calls != 0 {
				t.Fatal("signing authentication must not call App Store login")
			}
			response, err = service.LoginWithGSA("test@example.invalid", "test-password", endpoint)
			if err != nil || response == nil || !response.Success || *calls != 1 {
				t.Fatalf("download login fallback regressed: response=%+v err=%v calls=%d", response, err, *calls)
			}
		})
	}
}

func TestSigningNeverSubstitutesIDMSToken(t *testing.T) {
	service, endpoint, calls := newSigningTestService(t, &GSAStatus{}, nil)
	service.gsaAppToken = func(spd *SPDData, data *AnisetteData) (string, error) { return "", errors.New("app-token rejected") }
	response, err := service.LoginForSigning("test@example.invalid", "test-password", endpoint)
	if err == nil || response != nil && response.Success {
		t.Fatal("app-token failure must fail signing authentication")
	}
	if _, err := service.GetGSACredentials("test@example.invalid"); err == nil {
		t.Fatal("IDMS token was incorrectly saved as developer credentials")
	}
	if *calls != 0 {
		t.Fatal("app-token failure must not trigger App Store login")
	}
}

type signingFailKeychain struct{ authTestKeychain }

func (keychain signingFailKeychain) Set(key string, data []byte) error {
	if strings.HasPrefix(key, "gsa:") {
		return errors.New("test keyring write failed")
	}
	return keychain.authTestKeychain.Set(key, data)
}

func TestSigningReportsCredentialWriteFailure(t *testing.T) {
	service, endpoint, calls := newSigningTestService(t, &GSAStatus{}, nil)
	service.keychain = signingFailKeychain{service.keychain.(authTestKeychain)}
	response, err := service.LoginForSigning("test@example.invalid", "test-password", endpoint)
	if err == nil || !strings.Contains(err.Error(), "keyring write failed") || response != nil && response.Success {
		t.Fatalf("credential write failure was hidden: response=%+v err=%v", response, err)
	}
	if *calls != 0 {
		t.Fatal("credential write failure must not trigger App Store login")
	}
}

func TestSigningSuccessHasSavedXcodeToken(t *testing.T) {
	service, endpoint, calls := newSigningTestService(t, &GSAStatus{}, nil)
	response, err := service.LoginForSigning("test@example.invalid", "test-password", endpoint)
	if err != nil || response == nil || !response.Success {
		t.Fatalf("developer authentication failed: response=%+v err=%v", response, err)
	}
	creds, err := service.GetGSACredentials("test@example.invalid")
	if err != nil || creds.AuthToken != "test-xcode-token" {
		t.Fatalf("successful authentication did not persist its Xcode token: %v", err)
	}
	if *calls != 0 {
		t.Fatal("signing authentication must not depend on App Store login")
	}
}

func TestSigningPreservesPushedCodeContinuation(t *testing.T) {
	service, endpoint, calls := newSigningTestService(t, &GSAStatus{StatusCode: 409}, nil)
	response, err := service.LoginForSigning("test@example.invalid", "test-password", endpoint)
	if err != nil || response == nil || !response.Requires2FA || response.Success {
		t.Fatalf("expected pushed-code continuation: response=%+v err=%v", response, err)
	}
	pending, err := service.GetPending2FA("test@example.invalid")
	if err != nil || pending.AuthType != "pushedCode" || !pending.ForSigning {
		t.Fatalf("signing intent lost in pending verification: pending=%+v err=%v", pending, err)
	}
	if *calls != 0 {
		t.Fatal("developer 2FA must not invoke App Store login")
	}
}

func TestSigningRejectsIncompleteVerificationContext(t *testing.T) {
	service, endpoint, calls := newSigningTestService(t, &GSAStatus{StatusCode: 409}, nil)
	service.gsaLogin = func(username, password, udid, imd, imdm, cid string, stored *AnisetteStored) (*GSAStatus, []byte, error) {
		return &GSAStatus{StatusCode: 409}, nil, nil
	}
	response, err := service.LoginForSigning("test@example.invalid", "test-password", endpoint)
	if err == nil || response != nil && response.Requires2FA {
		t.Fatal("verification must not be offered without a usable pending context")
	}
	if *calls != 0 {
		t.Fatal("incomplete developer verification must not invoke App Store login")
	}
}

func TestSigningDoesNotSwitchAnisetteIdentity(t *testing.T) {
	service, endpoint, loginCalls := newSigningTestService(t, &GSAStatus{}, nil)
	fetchCalls := 0
	service.anisetteFetch = func(server string) (*AnisetteData, error) {
		fetchCalls++
		if server == endpoint {
			return nil, errors.New("selected provider unavailable")
		}
		return &AnisetteData{ClientTime: time.Now().UTC().Format(time.RFC3339), MD: "other-otp", MDM: "other-machine", DeviceID: "other-device"}, nil
	}
	service.gsaLogin = func(username, password, udid, imd, imdm, cid string, stored *AnisetteStored) (*GSAStatus, []byte, error) {
		t.Error("signing must not authenticate using a replacement identity")
		return &GSAStatus{ErrorCode: -80045, ErrorMessage: "wrong source"}, nil, nil
	}
	response, err := service.LoginForSigning("test@example.invalid", "test-password", endpoint)
	if err == nil || response != nil && response.Success || fetchCalls != 1 || *loginCalls != 0 {
		t.Fatalf("selected identity was not enforced: err=%v fetches=%d", err, fetchCalls)
	}
}

func TestAppStoreFallbackPreservesDeveloperSession(t *testing.T) {
	service, endpoint, _ := newSigningTestService(t, &GSAStatus{ErrorCode: -22421, ErrorMessage: "This action cannot be completed at this time"}, nil)
	email := "test@example.invalid"
	if err := service.SaveGSACredentials(email, &GSACredentials{DSID: "developer-dsid", AuthToken: "existing-xcode-token", AnisetteData: &AnisetteData{}}); err != nil {
		t.Fatal(err)
	}
	response, err := service.LoginWithGSA(email, "test-password", endpoint)
	if err != nil || response == nil || !response.Success {
		t.Fatalf("App Store fallback failed: %v", err)
	}
	creds, err := service.GetGSACredentials(email)
	if err != nil || creds.AuthToken != "existing-xcode-token" {
		t.Fatal("App Store fallback deleted an independent developer session")
	}
}

func TestSigningLiveAuthentication(t *testing.T) {
	if os.Getenv("IPAGET_TEST_SIGNING_LIVE") != "1" {
		t.Skip("set IPAGET_TEST_SIGNING_LIVE=1 to check saved-account developer authentication without issuing certificates")
	}
	logger.Init(false, true)
	t.Setenv("IPAGET_DUMP_GSA_PLIST", "0")
	configDir := filepath.Join(os.Getenv("APPDATA"), "iPAGet")
	data, err := os.ReadFile(filepath.Join(configDir, "config.json"))
	if err != nil {
		t.Fatal("desktop configuration is unavailable")
	}
	var config struct {
		SelectedEmail string `json:"selected_account_email"`
		SavedAccounts []struct {
			Email string `json:"email"`
		} `json:"saved_accounts"`
		Settings struct {
			AnisetteURL string `json:"anisette_url"`
			ProxyURL    string `json:"proxy_url"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal("desktop configuration is invalid")
	}
	if serverURL := os.Getenv("IPAGET_TEST_ANISETTE_SERVER"); serverURL != "" {
		config.Settings.AnisetteURL = serverURL
	}
	email := config.SelectedEmail
	if email == "" && len(config.SavedAccounts) == 1 {
		email = config.SavedAccounts[0].Email
	}
	if email == "" {
		t.Fatal("select an account in the desktop application first")
	}
	for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"} {
		t.Setenv(name, config.Settings.ProxyURL)
	}
	service := NewService(configDir, nil)
	serverURL := config.Settings.AnisetteURL
	if serverURL == "" {
		serverURL = service.getAnisetteServerURL()
	}
	if os.Getenv("IPAGET_TEST_GSA_PROFILE_STATE") == "1" {
		active, err := service.loadAnisetteData(email)
		if err != nil {
			t.Fatal("active login identity is unavailable")
		}
		stored, err := service.keychain.Get(anisetteV3StateKey(serverURL))
		if err != nil {
			t.Fatal("reference identity is unavailable")
		}
		var state anisetteV3State
		if err := json.Unmarshal(stored, &state); err != nil {
			t.Fatal(err)
		}
		deviceID, err := state.deviceID()
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("Active login identity matches reference server: %t", active.DeviceUniqueID == deviceID)
		if active.DeviceUniqueID != deviceID {
			t.Fatal("login silently switched away from the successful reference identity")
		}
		if pending, err := service.GetPending2FA(email); err == nil {
			t.Logf("Pending verification: type=%s signing=%t unexpired=%t", pending.AuthType, pending.ForSigning, time.Since(pending.CreatedAt) < 10*time.Minute)
		}
		return
	}
	if os.Getenv("IPAGET_TEST_GSA_DISCOVERY_COMPARE") == "1" {
		compareAnisetteDiscoveryRoutes(t, serverURL, config.Settings.ProxyURL)
		return
	}
	if referenceBinary := os.Getenv("IPAGET_TEST_GSA_REFERENCE_BIN"); referenceBinary != "" {
		compareReferenceGSAInit(t, service, serverURL, email, referenceBinary)
		return
	}
	profile, err := service.fetchSessionAnisette(serverURL)
	if err != nil {
		t.Fatalf("Anisette protocol preflight: %v", err)
	}
	if profile.UserAgent == "" || profile.GSAServiceURL == "" {
		t.Fatal("Anisette preflight selected legacy data rather than a registered v3 profile")
	}
	t.Log("Anisette v3 preflight succeeded with a persisted identity and paired client profile")
	if os.Getenv("IPAGET_TEST_GSA_TRANSPORT_COMPARE") == "1" {
		compareGSAInitTransports(t, email, profile)
		return
	}
	password, err := service.GetAccountPassword(email)
	if err != nil || password == "" {
		t.Fatal("the selected account has no saved password")
	}
	response, err := service.LoginForSigning(email, password, config.Settings.AnisetteURL)
	activeProfile, profileErr := service.loadAnisetteData(email)
	if profileErr != nil || activeProfile.UserAgent == "" {
		t.Fatal("active GSA login did not retain its v3 client profile")
	}
	if err != nil {
		t.Fatalf("developer authentication: %s", strings.ReplaceAll(err.Error(), email, "[account]"))
	}
	if response != nil && response.Requires2FA {
		t.Skip("Apple requires verification in the certificate login dialog; no certificate was issued")
	}
	if response == nil || !response.Success {
		t.Fatal("developer authentication did not complete")
	}
	if _, err := service.GetGSACredentials(email); err != nil {
		t.Fatal("developer authentication did not persist usable credentials")
	}
	t.Log("Developer authentication obtained and persisted an Xcode app token; no certificate was issued or revoked")
}

func compareGSAInitTransports(t *testing.T, email string, profile *AnisetteData) {
	t.Helper()
	curl, err := exec.LookPath("curl.exe")
	if err != nil {
		t.Skip("curl.exe is unavailable")
	}
	session := NewLoginSession(email, "unused-init-password")
	request := struct {
		Header  ReqVersion       `plist:"Header"`
		Request *GSAStep1Request `plist:"Request"`
	}{
		Header: ReqVersion{Version: "1.0.1"},
		Request: &GSAStep1Request{
			A2K: session.srp.A.Bytes(), UserName: normalizeEmailKey(email), Operation: "init", ProtoStyle: []string{"s2k", "s2k_fo"},
			CPD: &GSARequestCPD{BootStrap: true, ICSCrec: true, PRKGEN: true, Loc: "en_US", SVCT: "iCloud", IMD: profile.MD, IMDM: profile.MDM, UDID: profile.DeviceID},
		},
	}
	body, err := plist.MarshalIndent(request, plist.XMLFormat, "\t")
	if err != nil {
		t.Fatal(err)
	}
	httpRequest, err := http.NewRequest(http.MethodPost, profile.GSAServiceURL, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	setGSALoginHeaders(httpRequest, GSAHeaders{XMMEClientInfo: profile.ClientInfo, UserAgent: profile.UserAgent})
	transport := newGSATransportWithProxy(true)
	defer transport.CloseIdleConnections()
	response, err := (&http.Client{Transport: transport, Timeout: 30 * time.Second}).Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	goResponse, err := parseGSAStep1Response(response.StatusCode, response.Header.Get("Content-Type"), responseBody)
	if err != nil {
		t.Fatal(err)
	}
	arguments := []string{"--silent", "--show-error", "--http1.1", "--max-time", "30", "--cacert", "apple_root.pem", "--request", "POST", "--data-binary", "@-"}
	for name, values := range httpRequest.Header {
		for _, value := range values {
			arguments = append(arguments, "--header", name+": "+value)
		}
	}
	arguments = append(arguments, profile.GSAServiceURL)
	command := exec.Command(curl, arguments...)
	command.Stdin = bytes.NewReader(body)
	curlBody, err := command.Output()
	if err != nil {
		t.Fatalf("curl init request failed: %T", err)
	}
	curlResponse, err := parseGSAStep1Response(http.StatusOK, "text/x-xml-plist", curlBody)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Same-body init: Go ec=%d challenge=%t; curl ec=%d challenge=%t", goResponse.Status.ErrorCode, len(goResponse.SRPB) > 0, curlResponse.Status.ErrorCode, len(curlResponse.SRPB) > 0)
	if goResponse.Status.ErrorCode != 0 && curlResponse.Status.ErrorCode != 0 {
		t.Fatal("both transports were rejected before the password proof")
	}
}

func compareReferenceGSAInit(t *testing.T, service *Service, serverURL, email, binary string) {
	t.Helper()
	serverURL = strings.TrimRight(strings.TrimSpace(serverURL), "/")
	if !strings.Contains(serverURL, "://") {
		serverURL = "https://" + serverURL
	}
	stored, err := service.keychain.Get(anisetteV3StateKey(serverURL))
	var state anisetteV3State
	if err != nil {
		if !errors.Is(err, keyring.ErrKeyNotFound) {
			t.Fatal("reference probe could not load the existing v3 identity")
		}
		state.Identifier = make([]byte, 16)
		if _, err := rand.Read(state.Identifier); err != nil {
			t.Fatal(err)
		}
		if err := service.saveAnisetteV3State(anisetteV3StateKey(serverURL), &state); err != nil {
			t.Fatal(err)
		}
	} else if err := json.Unmarshal(stored, &state); err != nil {
		t.Fatal("reference probe identity is invalid")
	}
	serializedState := map[string]interface{}{"keychain_identifier": state.Identifier}
	if len(state.ADIPB) > 0 {
		serializedState["adi_pb"] = state.ADIPB
	}
	statePlist, err := plist.Marshal(serializedState, plist.XMLFormat)
	if err != nil {
		t.Fatal(err)
	}
	seed := make([]byte, 32)
	if _, err := rand.Read(seed); err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(map[string]interface{}{"server": serverURL, "email": email, "state_plist": statePlist, "ephemeral_seed": seed})
	if err != nil {
		t.Fatal(err)
	}
	probeContext, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(probeContext, binary)
	command.Stdin = bytes.NewReader(input)
	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			t.Fatalf("reference init probe: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		t.Fatalf("reference init probe could not run: %T", err)
	}
	var result struct {
		ErrorCode  int    `json:"ec"`
		Status     int    `json:"hsc"`
		Challenge  bool   `json:"challenge"`
		StatePlist []byte `json:"state_plist"`
		ServiceURL string `json:"service_url"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatal("reference probe returned invalid output")
	}
	var updated struct {
		Identifier []byte `plist:"keychain_identifier"`
		ADIPB      []byte `plist:"adi_pb"`
	}
	if _, err := plist.Unmarshal(result.StatePlist, &updated); err != nil {
		t.Fatal("reference probe returned invalid state")
	}
	if len(updated.Identifier) != 16 || len(updated.ADIPB) == 0 || len(state.ADIPB) > 0 && !bytes.Equal(updated.Identifier, state.Identifier) {
		t.Fatal("reference probe changed a registered identity or omitted its registered state")
	}
	if err := validateAppleGSAURL(result.ServiceURL); err != nil {
		t.Fatal(err)
	}
	state.Identifier = updated.Identifier
	state.ADIPB = updated.ADIPB
	state.ServiceURL = result.ServiceURL
	if err := service.saveAnisetteV3State(anisetteV3StateKey(serverURL), &state); err != nil {
		t.Fatal(err)
	}
	t.Logf("Unmodified isideload 0.5.0 init: ec=%d hsc=%d challenge=%t", result.ErrorCode, result.Status, result.Challenge)
	if result.ErrorCode != 0 || !result.Challenge {
		t.Fatal("the reference client did not obtain a password challenge")
	}
}

func compareAnisetteDiscoveryRoutes(t *testing.T, serverURL, configuredProxy string) {
	t.Helper()
	available := false
	for _, route := range []string{"cached", "configured", "direct"} {
		transport := newAnisetteV3Transport()
		if route == "direct" {
			transport.Proxy = nil
		}
		if route == "configured" {
			transport.Proxy = nil
			if configuredProxy != "" {
				proxy, err := url.Parse(configuredProxy)
				if err != nil {
					t.Fatal("configured proxy is invalid")
				}
				transport.Proxy = http.ProxyURL(proxy)
			}
		}
		request, err := http.NewRequest(http.MethodGet, strings.TrimRight(serverURL, "/")+"/v3/client_info", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Accept", "application/json")
		proxyRoute := "direct"
		if transport.Proxy != nil {
			proxy, err := transport.Proxy(request)
			if err != nil {
				t.Fatal("proxy route lookup failed")
			}
			if proxy != nil {
				proxyRoute = proxy.Scheme + "://" + proxy.Host
			}
		}
		response, err := (&http.Client{Transport: transport, Timeout: 15 * time.Second}).Do(request)
		if err != nil {
			t.Logf("Discovery route=%s proxy=%s error=%T", route, proxyRoute, err)
		} else {
			t.Logf("Discovery route=%s proxy=%s status=%d protocol=%s host=%s", route, proxyRoute, response.StatusCode, response.Proto, response.Request.URL.Host)
			available = available || response.StatusCode == http.StatusOK
			response.Body.Close()
		}
		transport.CloseIdleConnections()
	}
	if !available {
		t.Fatal("no Go discovery route succeeded")
	}
}
