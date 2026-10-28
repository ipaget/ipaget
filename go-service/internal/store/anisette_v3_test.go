package store

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/99designs/keyring"
	"github.com/gorilla/websocket"
	"howett.net/plist"
)

func TestAnisetteV3IdentityMatchesIloader(t *testing.T) {
	identifier := make([]byte, 16)
	for index := range identifier {
		identifier[index] = byte(index)
	}
	state := anisetteV3State{Identifier: identifier}
	deviceID, err := state.deviceID()
	if err != nil {
		t.Fatal(err)
	}
	if deviceID != "00010203-0405-0607-0809-0a0b0c0d0e0f" {
		t.Fatalf("unexpected device identifier %q", deviceID)
	}
	if actual := state.localUserID(); actual != "be45cb2605bf36bebde684841a28f0fd43c69850a3dce5fedba69928ee3a8991" {
		t.Fatalf("unexpected MD-LU %q", actual)
	}
	state.Identifier = []byte{1}
	if _, err := state.deviceID(); err == nil {
		t.Fatal("malformed identifiers must be rejected")
	}
}

func TestDefaultAnisetteServerUsesIloaderDefaultFirst(t *testing.T) {
	servers := GetDefaultAnisetteServers()
	if len(servers) == 0 || servers[0] != defaultSigningAnisetteURL {
		t.Fatalf("first fallback server = %v, want %s", servers, defaultSigningAnisetteURL)
	}
}

type anisetteFixtureKeychain struct{ authTestKeychain }

func (store anisetteFixtureKeychain) Get(key string) ([]byte, error) {
	if data, exists := store.authTestKeychain[key]; exists {
		return data, nil
	}
	return nil, keyring.ErrKeyNotFound
}

func TestAnisetteV3ReusesIdentityAndRefreshesHeaders(t *testing.T) {
	identifier := []byte("0123456789abcdef")
	blob := []byte("test-adi-blob")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v3/client_info":
			json.NewEncoder(writer).Encode(map[string]string{"client_info": "paired-client", "user_agent": "paired-agent"})
		case "/v3/get_headers":
			if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" {
				t.Error("invalid v3 header request")
			}
			var input map[string]string
			if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
				t.Error(err)
				return
			}
			if input["identifier"] != base64.StdEncoding.EncodeToString(identifier) || input["adi_pb"] != base64.StdEncoding.EncodeToString(blob) {
				t.Error("v3 state was not encoded and reused correctly")
			}
			requests++
			otp := "first-otp"
			if requests > 1 {
				otp = "second-otp"
			}
			json.NewEncoder(writer).Encode(map[string]string{"result": "Headers", "X-Apple-I-MD": otp, "X-Apple-I-MD-M": "test-machine", "X-Apple-I-MD-RINFO": "17106176"})
		default:
			t.Errorf("registered identity unexpectedly requested %s", request.URL.Path)
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	service := &Service{keychain: anisetteFixtureKeychain{authTestKeychain{}}}
	state := &anisetteV3State{Identifier: identifier, ADIPB: blob, ServiceURL: gsaServiceURL}
	if err := service.saveAnisetteV3State(anisetteV3StateKey(server.URL), state); err != nil {
		t.Fatal(err)
	}
	provider := anisetteV3Provider{serverURL: server.URL, client: server.Client()}
	first, err := provider.fetch(service)
	if err != nil {
		t.Fatal(err)
	}
	second, err := provider.fetch(service)
	if err != nil {
		t.Fatal(err)
	}
	if first.DeviceID != second.DeviceID || first.MDLU != second.MDLU || first.MD == second.MD {
		t.Fatal("identity must persist while OTP is refreshed")
	}
	if first.UserAgent != "paired-agent" || first.ClientInfo != "paired-client" || first.GSAServiceURL != gsaServiceURL {
		t.Fatal("paired client identity or GSA endpoint was lost")
	}
	if requests != 2 {
		t.Fatalf("got %d header requests, want 2", requests)
	}
	cachedFirst, err := service.fetchSessionAnisette(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	cachedFirst.MD = "modified-by-caller"
	cachedSecond, err := service.fetchSessionAnisette(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 3 {
		t.Fatalf("session callers fetched %d headers; short-lived cache was not reused", requests)
	}
	if cachedSecond.MD == "modified-by-caller" {
		t.Fatal("callers must not mutate the cached identity")
	}
	service.anisetteCacheMu.Lock()
	entry := service.anisetteCache[server.URL]
	entry.CreatedAt = time.Now().Add(-61 * time.Second)
	service.anisetteCache[server.URL] = entry
	service.anisetteCacheMu.Unlock()
	if _, err := service.fetchSessionAnisette(server.URL); err != nil {
		t.Fatal(err)
	}
	if requests != 4 {
		t.Fatal("expired Anisette headers must be refreshed")
	}
}

type anisetteFixtureTransport func(*http.Request) (*http.Response, error)

func (transport anisetteFixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestAnisetteV3ProvisioningMatchesIloader(t *testing.T) {
	blob := []byte("registered-adi-blob")
	var receivedIdentifier string
	starts, finishes := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writePlist := func(data map[string]interface{}) {
			encoded, err := plist.Marshal(data, plist.XMLFormat)
			if err != nil {
				t.Error(err)
				return
			}
			writer.Header().Set("Content-Type", "text/x-xml-plist")
			writer.Write(encoded)
		}
		switch request.URL.Path {
		case "/v3/client_info":
			json.NewEncoder(writer).Encode(map[string]string{"client_info": "paired-client", "user_agent": "paired-agent"})
		case "/lookup":
			if request.Header.Get("User-Agent") != "paired-agent" {
				t.Error("lookup lost the provider user agent")
			}
			writePlist(map[string]interface{}{"urls": map[string]interface{}{"midStartProvisioning": "https://gsa.apple.com/start", "midFinishProvisioning": "https://gsa.apple.com/finish", "gsService": gsaServiceURL}})
		case "/start", "/finish":
			if request.Header.Get("User-Agent") != "paired-agent" || request.Header.Get("X-MMe-Client-Info") != "paired-client" || request.Header.Get("X-Apple-I-MD-LU") == "" || request.Header.Get("X-Mme-Device-Id") == "" {
				t.Error("provisioning identity headers are incomplete")
			}
			var body struct {
				Request map[string]interface{} `plist:"Request"`
			}
			encoded, err := io.ReadAll(request.Body)
			if err != nil {
				t.Error(err)
				return
			}
			if _, err := plist.Unmarshal(encoded, &body); err != nil {
				t.Error(err)
				return
			}
			if request.URL.Path == "/start" {
				starts++
				writePlist(map[string]interface{}{"Response": map[string]interface{}{"spim": "test-spim"}})
			} else {
				finishes++
				if body.Request["cpim"] != "test-cpim" {
					t.Error("finish provisioning did not forward CPIM")
				}
				writePlist(map[string]interface{}{"Response": map[string]interface{}{"ptm": "test-ptm", "tk": "test-tk"}})
			}
		case "/v3/provisioning_session":
			connection, err := (&websocket.Upgrader{}).Upgrade(writer, request, nil)
			if err != nil {
				t.Error(err)
				return
			}
			defer connection.Close()
			connection.SetReadDeadline(time.Now().Add(3 * time.Second))
			for _, step := range []struct{ result, key, expected string }{
				{"GiveIdentifier", "identifier", ""}, {"GiveStartProvisioningData", "spim", "test-spim"}, {"GiveEndProvisioningData", "ptm", "test-ptm"},
			} {
				message := map[string]string{"result": step.result}
				if step.result == "GiveEndProvisioningData" {
					message["cpim"] = "test-cpim"
				}
				if err := connection.WriteJSON(message); err != nil {
					t.Error(err)
					return
				}
				var reply map[string]string
				if err := connection.ReadJSON(&reply); err != nil {
					t.Error(err)
					return
				}
				if step.result == "GiveIdentifier" {
					receivedIdentifier = reply["identifier"]
					decoded, err := base64.StdEncoding.DecodeString(receivedIdentifier)
					if err != nil || len(decoded) != 16 {
						t.Error("identifier must be 16 bytes encoded as base64")
					}
				} else if reply[step.key] != step.expected {
					t.Errorf("incorrect %s reply", step.result)
				}
				if step.result == "GiveEndProvisioningData" && reply["tk"] != "test-tk" {
					t.Error("finish provisioning did not forward TK")
				}
			}
			connection.WriteJSON(map[string]string{"result": "ProvisioningSuccess", "adi_pb": base64.StdEncoding.EncodeToString(blob)})
			if _, _, err := connection.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				t.Error("provisioning must finish with a normal WebSocket close frame")
			}
		case "/v3/get_headers":
			var input map[string]string
			if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
				t.Error(err)
				return
			}
			if input["identifier"] != receivedIdentifier || input["adi_pb"] != base64.StdEncoding.EncodeToString(blob) {
				t.Error("registered identity or ADI blob was lost")
			}
			json.NewEncoder(writer).Encode(map[string]string{"result": "Headers", "X-Apple-I-MD": "registered-otp", "X-Apple-I-MD-M": "registered-machine", "X-Apple-I-MD-RINFO": "17106176"})
		default:
			t.Errorf("unexpected fixture path %s", request.URL.Path)
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	target, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: 3 * time.Second, Transport: anisetteFixtureTransport(func(request *http.Request) (*http.Response, error) {
		cloned := request.Clone(request.Context())
		if cloned.URL.Host == "gsa.apple.com" {
			cloned.URL.Scheme = target.Scheme
			cloned.URL.Host = target.Host
		}
		if cloned.URL.Host != target.Host {
			return nil, errors.New("unexpected external fixture request")
		}
		return transport.RoundTrip(cloned)
	})}
	service := &Service{keychain: anisetteFixtureKeychain{authTestKeychain{}}}
	proxyCalls := 0
	proxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		proxyCalls++
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer proxyServer.Close()
	proxyURL, err := url.Parse(proxyServer.URL)
	if err != nil {
		t.Fatal(err)
	}
	provider := anisetteV3Provider{serverURL: server.URL, lookupURL: "https://gsa.apple.com/lookup", client: client, dialer: &websocket.Dialer{Proxy: http.ProxyURL(proxyURL), HandshakeTimeout: 3 * time.Second}}
	data, err := provider.fetch(service)
	if err != nil {
		t.Fatal(err)
	}
	if data.MD != "registered-otp" || starts != 1 || finishes != 1 {
		t.Fatal("provisioning sequence did not complete exactly once")
	}
	stored, err := service.keychain.Get(anisetteV3StateKey(server.URL))
	if err != nil {
		t.Fatal(err)
	}
	var state anisetteV3State
	if err := json.Unmarshal(stored, &state); err != nil {
		t.Fatal(err)
	}
	if string(state.ADIPB) != string(blob) {
		t.Fatal("ADI state was not persisted")
	}
	if _, err := provider.fetch(service); err != nil {
		t.Fatal(err)
	}
	if starts != 1 || finishes != 1 {
		t.Fatal("registered state was unnecessarily provisioned again")
	}
	if proxyCalls != 1 {
		t.Fatal("WebSocket proxy handshake must be tried once before a direct attempt")
	}
}

func TestAnisetteV3RetriesOnlyProxyGatewayFailures(t *testing.T) {
	for _, status := range []int{http.StatusBadGateway, http.StatusUnauthorized, 0} {
		name := http.StatusText(status)
		if status == 0 {
			name = "Proxy timeout"
		}
		t.Run(name, func(t *testing.T) {
			directCalls, proxyCalls := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				directCalls++
				if request.URL.Path == "/v3/client_info" {
					json.NewEncoder(writer).Encode(map[string]string{"client_info": "paired-client", "user_agent": "paired-agent"})
					return
				}
				var body map[string]string
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if request.Method != http.MethodPost || body["adi_pb"] != base64.StdEncoding.EncodeToString([]byte("test-blob")) {
					t.Error("proxy retry did not replay the header request correctly")
				}
				json.NewEncoder(writer).Encode(map[string]string{"result": "Headers", "X-Apple-I-MD": "test-otp", "X-Apple-I-MD-M": "test-mdm", "X-Apple-I-MD-RINFO": "17106176"})
			}))
			defer server.Close()
			releaseProxy := make(chan struct{})
			proxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				proxyCalls++
				if status == 0 {
					<-releaseProxy
					return
				}
				writer.WriteHeader(status)
			}))
			defer func() { close(releaseProxy); proxyServer.Close() }()
			proxyURL, err := url.Parse(proxyServer.URL)
			if err != nil {
				t.Fatal(err)
			}
			transport := newAnisetteV3Transport()
			transport.Proxy = http.ProxyURL(proxyURL)
			defer transport.CloseIdleConnections()
			service := &Service{keychain: anisetteFixtureKeychain{authTestKeychain{}}}
			if err := service.saveAnisetteV3State(anisetteV3StateKey(server.URL), &anisetteV3State{Identifier: []byte("0123456789abcdef"), ADIPB: []byte("test-blob")}); err != nil {
				t.Fatal(err)
			}
			timeout := 3 * time.Second
			if status == 0 {
				timeout = 150 * time.Millisecond
			}
			provider := anisetteV3Provider{serverURL: server.URL, client: &http.Client{Transport: transport, Timeout: timeout}}
			data, err := provider.fetch(service)
			if status == http.StatusBadGateway || status == 0 {
				if err != nil || data == nil || directCalls != 2 || proxyCalls != 2 {
					t.Fatalf("gateway fallback failed: err=%v direct=%d proxy=%d", err, directCalls, proxyCalls)
				}
			} else if err == nil || directCalls != 0 || proxyCalls != 1 {
				t.Fatal("authentication failures must not trigger a direct retry")
			}
		})
	}
}

func TestAppleRootMatchesIloaderAndVerifiesTLS(t *testing.T) {
	block, _ := pem.Decode(appleRootPEM)
	if block == nil {
		t.Fatal("Apple root PEM is invalid")
	}
	digest := sha256.Sum256(block.Bytes)
	if hex.EncodeToString(digest[:]) != "b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024" {
		t.Fatal("Apple root fingerprint differs from iloader")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	config := appleTLSConfig()
	if config.InsecureSkipVerify || config.RootCAs == nil {
		t.Fatal("TLS verification must remain enabled")
	}
	if _, err := certificate.Verify(x509.VerifyOptions{Roots: config.RootCAs}); err != nil {
		t.Fatal(err)
	}
}

func TestAnisetteV3TransportKeepsTLSVerification(t *testing.T) {
	transport := newAnisetteV3Transport()
	defer transport.CloseIdleConnections()
	if transport.TLSClientConfig.InsecureSkipVerify || transport.TLSClientConfig.RootCAs == nil {
		t.Fatal("v3 transport must validate server certificates")
	}
	if transport.TLSClientConfig.MaxVersion != 0 {
		t.Fatal("v3 TLS must not be restricted to the old TLS 1.2 ceiling")
	}
}

func TestAnisetteV3SocketMatchesIloaderRoute(t *testing.T) {
	dialer := newAnisetteV3Dialer()
	if dialer.Proxy != nil || dialer.HandshakeTimeout <= 0 {
		t.Fatal("native v3 provisioning must use the reference direct route with a bounded handshake")
	}
	if dialer.TLSClientConfig != nil && dialer.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("provisioning must verify the TLS server")
	}
}

func TestAnisetteV3LiveProvisioning(t *testing.T) {
	if os.Getenv("IPAGET_TEST_ANISETTE_V3_LIVE") != "1" {
		t.Skip("set IPAGET_TEST_ANISETTE_V3_LIVE=1 to provision an anonymous in-memory identity")
	}
	var config struct {
		Settings struct {
			ProxyURL string `json:"proxy_url"`
		} `json:"settings"`
	}
	data, err := os.ReadFile(filepath.Join(os.Getenv("APPDATA"), "iPAGet", "config.json"))
	if err != nil {
		t.Fatal("desktop proxy configuration is unavailable")
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal("desktop proxy configuration is invalid")
	}
	for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"} {
		t.Setenv(name, config.Settings.ProxyURL)
	}
	service := &Service{keychain: anisetteFixtureKeychain{authTestKeychain{}}}
	profile, err := service.fetchSessionAnisette(defaultSigningAnisetteURL)
	if err != nil {
		t.Fatal(err)
	}
	if profile.UserAgent == "" || profile.GSAServiceURL == "" {
		t.Fatal("live provisioning did not produce a v3 profile")
	}
	stored, err := service.keychain.Get(anisetteV3StateKey(defaultSigningAnisetteURL))
	if err != nil {
		t.Fatal(err)
	}
	var state anisetteV3State
	if err := json.Unmarshal(stored, &state); err != nil {
		t.Fatal(err)
	}
	if len(state.Identifier) != 16 || len(state.ADIPB) == 0 {
		t.Fatal("live provisioning did not persist a registered identity")
	}
	t.Log("Go independently provisioned a v3 identity in memory; no account was read or authenticated and no certificate was requested")
}
