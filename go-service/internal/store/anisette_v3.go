package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/99designs/keyring"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"howett.net/plist"
)

var anisetteV3StateMu sync.Mutex

var nativeAnisetteHTTP func(*http.Request, *url.URL, time.Duration) (*http.Response, error)

const defaultSigningAnisetteURL = "https://new.ani.sidestore.io"

type anisetteV3ClientInfo struct {
	ClientInfo string `json:"client_info"`
	UserAgent  string `json:"user_agent"`
	LegacyMD   string `json:"X-Apple-I-MD"`
	LegacyMDM  string `json:"X-Apple-I-MD-M"`
}

type anisetteV3Provider struct {
	serverURL string
	lookupURL string
	client    *http.Client
	dialer    *websocket.Dialer
}

type anisetteV3CacheEntry struct {
	Data      AnisetteData
	CreatedAt time.Time
}

type anisetteV3State struct {
	Identifier []byte `json:"identifier"`
	ADIPB      []byte `json:"adi_pb,omitempty"`
	ServiceURL string `json:"gsa_service_url,omitempty"`
}

func (state *anisetteV3State) deviceID() (string, error) {
	identifier, err := uuid.FromBytes(state.Identifier)
	if err != nil {
		return "", fmt.Errorf("invalid anisette identifier: %w", err)
	}
	return identifier.String(), nil
}

func (state *anisetteV3State) localUserID() string {
	digest := sha256.Sum256(state.Identifier)
	return hex.EncodeToString(digest[:])
}

func anisetteV3StateKey(serverURL string) string {
	digest := sha256.Sum256([]byte(strings.TrimRight(serverURL, "/")))
	return "anisette-v3:" + hex.EncodeToString(digest[:])
}

func validateAppleGSAURL(endpoint string) error {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Fragment != "" ||
		!strings.HasSuffix(strings.ToLower(parsed.Hostname()), ".apple.com") ||
		(parsed.Port() != "" && parsed.Port() != "443") {
		return fmt.Errorf("invalid Apple authentication endpoint")
	}
	return nil
}

func newAnisetteV3Transport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = appleTLSConfig()
	return transport
}

func newAnisetteV3Dialer() *websocket.Dialer {
	return &websocket.Dialer{HandshakeTimeout: 30 * time.Second}
}

func (s *Service) fetchSessionAnisette(serverURL string) (*AnisetteData, error) {
	serverURL = strings.TrimRight(strings.TrimSpace(serverURL), "/")
	if !strings.Contains(serverURL, "://") {
		serverURL = "https://" + serverURL
	}
	parsed, err := url.Parse(serverURL)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, fmt.Errorf("invalid Anisette server URL")
	}
	s.anisetteCacheMu.Lock()
	defer s.anisetteCacheMu.Unlock()
	if entry, exists := s.anisetteCache[serverURL]; exists {
		age := time.Since(entry.CreatedAt)
		if age >= 0 && age < 60*time.Second {
			data := entry.Data
			return &data, nil
		}
	}
	transport := newAnisetteV3Transport()
	defer transport.CloseIdleConnections()
	provider := anisetteV3Provider{
		serverURL: serverURL, lookupURL: gsaServiceURL + "/lookup",
		client: &http.Client{Transport: transport, Timeout: 30 * time.Second},
		dialer: newAnisetteV3Dialer(),
	}
	data, err := provider.fetch(s)
	if err != nil {
		return nil, err
	}
	if s.anisetteCache == nil {
		s.anisetteCache = make(map[string]anisetteV3CacheEntry)
	}
	s.anisetteCache[serverURL] = anisetteV3CacheEntry{Data: *data, CreatedAt: time.Now()}
	return data, nil
}

func (provider *anisetteV3Provider) jsonRequest(ctx context.Context, method, endpoint string, input, output interface{}) (int, error) {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return 0, err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/json")
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := provider.doMetadataRequest(request)
	if err != nil {
		return 0, fmt.Errorf("Anisette request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return response.StatusCode, fmt.Errorf("Anisette %s returned HTTP %d over %s", request.URL.EscapedPath(), response.StatusCode, response.Proto)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(output); err != nil {
		return response.StatusCode, fmt.Errorf("invalid Anisette JSON response: %w", err)
	}
	return response.StatusCode, nil
}

func isAnisetteGatewayFailure(status int) bool {
	return status == http.StatusBadGateway || status == http.StatusServiceUnavailable || status == http.StatusGatewayTimeout
}

func (provider *anisetteV3Provider) doMetadataRequest(request *http.Request) (*http.Response, error) {
	response, err := executeAnisetteMetadata(provider.client, request)
	retryable := err == nil && response != nil && isAnisetteGatewayFailure(response.StatusCode)
	if err != nil {
		var networkError net.Error
		retryable = errors.As(err, &networkError) && networkError.Timeout()
	}
	if !retryable || request.Context().Err() != nil {
		return response, err
	}
	transport, ok := provider.client.Transport.(*http.Transport)
	if !ok || transport.Proxy == nil {
		return response, err
	}
	proxy, proxyErr := transport.Proxy(request)
	if proxyErr != nil || proxy == nil {
		return response, err
	}
	replayed := request.Clone(request.Context())
	if request.GetBody != nil {
		body, bodyErr := request.GetBody()
		if bodyErr != nil {
			return response, err
		}
		replayed.Body = body
	} else if request.Body != nil && request.Body != http.NoBody {
		return response, err
	}
	if response != nil {
		response.Body.Close()
	}
	directTransport := transport.Clone()
	directTransport.Proxy = nil
	defer directTransport.CloseIdleConnections()
	directClient := *provider.client
	directClient.Transport = directTransport
	return executeAnisetteMetadata(&directClient, replayed)
}

func executeAnisetteMetadata(client *http.Client, request *http.Request) (*http.Response, error) {
	if nativeAnisetteHTTP != nil && request.URL.Scheme == "https" {
		if transport, ok := client.Transport.(*http.Transport); ok {
			var proxy *url.URL
			if transport.Proxy != nil {
				var err error
				proxy, err = transport.Proxy(request)
				if err != nil {
					return nil, err
				}
			}
			if proxy == nil || proxy.Scheme == "http" && proxy.User == nil {
				return nativeAnisetteHTTP(request, proxy, client.Timeout)
			}
		}
	}
	return client.Do(request)
}

func (provider *anisetteV3Provider) openProvisioningSocket(ctx context.Context, endpoint string) (*websocket.Conn, error) {
	connection, response, err := provider.dialer.DialContext(ctx, endpoint, nil)
	if err == nil {
		return connection, nil
	}
	status := 0
	if response != nil {
		status = response.StatusCode
		response.Body.Close()
	}
	retryable := isAnisetteGatewayFailure(status)
	if response == nil {
		retryable = strings.Contains(err.Error(), "Bad Gateway") || strings.Contains(err.Error(), "Service Unavailable") || strings.Contains(err.Error(), "Gateway Timeout")
	}
	if retryable && provider.dialer.Proxy != nil && ctx.Err() == nil {
		proxyURL, parseErr := url.Parse(endpoint)
		if parseErr != nil {
			return nil, parseErr
		}
		if proxyURL.Scheme == "wss" {
			proxyURL.Scheme = "https"
		} else {
			proxyURL.Scheme = "http"
		}
		request, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, proxyURL.String(), nil)
		if requestErr != nil {
			return nil, requestErr
		}
		proxy, proxyErr := provider.dialer.Proxy(request)
		if proxyErr == nil && proxy != nil {
			directDialer := *provider.dialer
			directDialer.Proxy = nil
			connection, response, err = directDialer.DialContext(ctx, endpoint, nil)
			if err == nil {
				return connection, nil
			}
			if response != nil {
				status = response.StatusCode
				response.Body.Close()
			}
		}
	}
	if status != 0 {
		return nil, fmt.Errorf("Anisette provisioning socket failed with HTTP %d", status)
	}
	return nil, fmt.Errorf("Anisette provisioning socket failed: %w", err)
}

func (provider *anisetteV3Provider) fetch(service *Service) (*AnisetteData, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	var info anisetteV3ClientInfo
	status, err := provider.jsonRequest(ctx, http.MethodGet, provider.serverURL+"/v3/client_info", nil, &info)
	if status == http.StatusNotFound || status == http.StatusOK && info.ClientInfo == "" && info.LegacyMD != "" && info.LegacyMDM != "" {
		return FetchAnisetteData(provider.serverURL)
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(info.ClientInfo) == "" || strings.TrimSpace(info.UserAgent) == "" {
		return nil, fmt.Errorf("Anisette v3 client identity is incomplete")
	}
	anisetteV3StateMu.Lock()
	defer anisetteV3StateMu.Unlock()
	key := anisetteV3StateKey(provider.serverURL)
	state := &anisetteV3State{}
	stored, err := service.keychain.Get(key)
	if err != nil {
		if !errors.Is(err, keyring.ErrKeyNotFound) {
			return nil, fmt.Errorf("failed to load Anisette v3 identity: %w", err)
		}
		state.Identifier = make([]byte, 16)
		if _, err := rand.Read(state.Identifier); err != nil {
			return nil, err
		}
		if err := service.saveAnisetteV3State(key, state); err != nil {
			return nil, err
		}
	} else if err := json.Unmarshal(stored, state); err != nil {
		return nil, fmt.Errorf("stored Anisette v3 identity is invalid: %w", err)
	}
	if _, err := state.deviceID(); err != nil {
		return nil, err
	}
	if len(state.ADIPB) == 0 {
		if err := provider.provision(ctx, state, info); err != nil {
			return nil, err
		}
		if err := service.saveAnisetteV3State(key, state); err != nil {
			return nil, err
		}
	}
	if state.ServiceURL != "" {
		if err := validateAppleGSAURL(state.ServiceURL); err != nil {
			return nil, err
		}
	}
	var headers struct {
		Result      string `json:"result"`
		MD          string `json:"X-Apple-I-MD"`
		MDM         string `json:"X-Apple-I-MD-M"`
		RoutingInfo string `json:"X-Apple-I-MD-RINFO"`
	}
	_, err = provider.jsonRequest(ctx, http.MethodPost, provider.serverURL+"/v3/get_headers", map[string]string{
		"identifier": base64.StdEncoding.EncodeToString(state.Identifier), "adi_pb": base64.StdEncoding.EncodeToString(state.ADIPB),
	}, &headers)
	if err != nil {
		return nil, err
	}
	if headers.Result != "Headers" || headers.MD == "" || headers.MDM == "" {
		return nil, fmt.Errorf("Anisette v3 did not return usable headers; stored identity was preserved")
	}
	if _, err := strconv.ParseUint(headers.RoutingInfo, 10, 64); err != nil {
		return nil, fmt.Errorf("invalid Anisette routing information")
	}
	deviceID, err := state.deviceID()
	if err != nil {
		return nil, err
	}
	return &AnisetteData{
		MD: headers.MD, MDM: headers.MDM, MDRINFO: headers.RoutingInfo, MDLU: state.localUserID(),
		DeviceID: deviceID, SRLNO: "0", ClientInfo: info.ClientInfo, UserAgent: info.UserAgent,
		ClientTime: time.Now().UTC().Format(time.RFC3339), Locale: "en_US", TimeZone: "UTC", GSAServiceURL: state.ServiceURL,
	}, nil
}

func (s *Service) saveAnisetteV3State(key string, state *anisetteV3State) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err := s.keychain.Set(key, data); err != nil {
		return fmt.Errorf("failed to save Anisette v3 identity: %w", err)
	}
	return nil
}

func (provider *anisetteV3Provider) appleRequest(ctx context.Context, endpoint string, payload map[string]interface{}, headers http.Header, info anisetteV3ClientInfo) (map[string]interface{}, error) {
	if err := validateAppleGSAURL(endpoint); err != nil {
		return nil, err
	}
	var body io.Reader
	method := http.MethodGet
	if payload != nil {
		encoded, err := plist.Marshal(payload, plist.XMLFormat)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
		method = http.MethodPost
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	setGSALoginHeaders(request, GSAHeaders{XMMEClientInfo: info.ClientInfo})
	request.Header.Set("User-Agent", info.UserAgent)
	for name, values := range headers {
		request.Header[name] = append([]string(nil), values...)
	}
	response, err := provider.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Apple provisioning request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Apple provisioning returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if _, err := plist.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("invalid Apple provisioning plist: %w", err)
	}
	return result, nil
}

func (provider *anisetteV3Provider) provision(ctx context.Context, state *anisetteV3State, info anisetteV3ClientInfo) error {
	lookupHeaders := make(http.Header)
	lookupHeaders.Set("X-MMe-Client-Info", "<Mac15,7> <macOS;27.0;26A5378j> <com.apple.AuthKit/1 (com.apple.akd/1.0)>")
	lookup, err := provider.appleRequest(ctx, provider.lookupURL, nil, lookupHeaders, info)
	if err != nil {
		return err
	}
	urls, ok := lookup["urls"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("Apple lookup did not return a URL bag")
	}
	startURL, _ := urls["midStartProvisioning"].(string)
	finishURL, _ := urls["midFinishProvisioning"].(string)
	serviceURL, _ := urls["gsService"].(string)
	for _, endpoint := range []string{startURL, finishURL, serviceURL} {
		if err := validateAppleGSAURL(endpoint); err != nil {
			return err
		}
	}
	websocketURL, err := url.Parse(provider.serverURL + "/v3/provisioning_session")
	if err != nil {
		return err
	}
	if websocketURL.Scheme == "https" {
		websocketURL.Scheme = "wss"
	} else {
		websocketURL.Scheme = "ws"
	}
	connection, err := provider.openProvisioningSocket(ctx, websocketURL.String())
	if err != nil {
		return err
	}
	defer connection.Close()
	stop := context.AfterFunc(ctx, func() { connection.Close() })
	defer stop()
	connection.SetReadLimit(1 << 20)
	deadline, _ := ctx.Deadline()
	if err := connection.SetReadDeadline(deadline); err != nil {
		return err
	}
	deviceID, err := state.deviceID()
	if err != nil {
		return err
	}
	headers := make(http.Header)
	headers.Set("X-Apple-I-MD-LU", state.localUserID())
	headers.Set("X-Mme-Device-Id", deviceID)
	for step := 0; step < 4; step++ {
		var message struct {
			Result string `json:"result"`
			CPIM   string `json:"cpim"`
			ADIPB  string `json:"adi_pb"`
		}
		if err := connection.ReadJSON(&message); err != nil {
			return fmt.Errorf("Anisette provisioning response failed at step %d: %w", step+1, err)
		}
		var reply map[string]string
		switch {
		case step == 0 && message.Result == "GiveIdentifier":
			reply = map[string]string{"identifier": base64.StdEncoding.EncodeToString(state.Identifier)}
		case step == 1 && message.Result == "GiveStartProvisioningData":
			response, err := provider.appleRequest(ctx, startURL, map[string]interface{}{"Header": map[string]interface{}{}, "Request": map[string]interface{}{}}, headers, info)
			if err != nil {
				return err
			}
			response, ok = response["Response"].(map[string]interface{})
			if !ok {
				return fmt.Errorf("Apple start provisioning omitted its response")
			}
			spim, _ := response["spim"].(string)
			if spim == "" {
				return fmt.Errorf("Apple start provisioning omitted spim")
			}
			reply = map[string]string{"spim": spim}
		case step == 2 && message.Result == "GiveEndProvisioningData" && message.CPIM != "":
			response, err := provider.appleRequest(ctx, finishURL, map[string]interface{}{"Header": map[string]interface{}{}, "Request": map[string]interface{}{"cpim": message.CPIM}}, headers, info)
			if err != nil {
				return err
			}
			response, ok = response["Response"].(map[string]interface{})
			if !ok {
				return fmt.Errorf("Apple finish provisioning omitted its response")
			}
			ptm, _ := response["ptm"].(string)
			token, _ := response["tk"].(string)
			if ptm == "" || token == "" {
				return fmt.Errorf("Apple finish provisioning omitted ptm or tk")
			}
			reply = map[string]string{"ptm": ptm, "tk": token}
		case step == 3 && message.Result == "ProvisioningSuccess":
			blob, err := base64.StdEncoding.DecodeString(message.ADIPB)
			if err != nil || len(blob) == 0 {
				return fmt.Errorf("Anisette provisioning returned an invalid ADI blob")
			}
			state.ADIPB = blob
			state.ServiceURL = serviceURL
			if err := connection.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(5*time.Second)); err != nil {
				return fmt.Errorf("failed to finish Anisette provisioning session: %w", err)
			}
			return nil
		default:
			return fmt.Errorf("Anisette provisioning failed at step %d", step+1)
		}
		if err := connection.SetWriteDeadline(time.Now().Add(15 * time.Second)); err != nil {
			return err
		}
		if err := connection.WriteJSON(reply); err != nil {
			return fmt.Errorf("Anisette provisioning reply failed: %w", err)
		}
	}
	return fmt.Errorf("Anisette provisioning did not complete")
}
