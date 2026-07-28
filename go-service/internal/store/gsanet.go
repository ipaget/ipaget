package store

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	"ipaget-service/internal/logger"

	"strings"

	"howett.net/plist"
)

func shouldDumpGSAPlist() bool {
	v := strings.TrimSpace(os.Getenv("IPAGET_DUMP_GSA_PLIST"))
	if v == "" {
		return false
	}
	v = strings.ToLower(v)
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

const (
	gsaServiceURL = "https://gsa.apple.com/grandslam/GsService2"
)

func doGSARequestWithRetry(client *http.Client, buildRequest func() (*http.Request, error), operation string) (*http.Response, error) {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		httpReq, err := buildRequest()
		if err != nil {
			return nil, err
		}

		resp, err := client.Do(httpReq)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if !isTransientGSAError(err) || attempt == 3 {
			break
		}

		logger.Warn().Err(err).Str("operation", operation).Int("attempt", attempt).Msg("Transient GSA request error; retrying")
		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}

	return nil, fmt.Errorf("request failed: %w", lastErr)
}

func isTransientGSAError(err error) bool {
	if err == nil {
		return false
	}
	if _, ok := err.(net.Error); ok {
		return true
	}
	errText := strings.ToLower(err.Error())
	return strings.Contains(errText, "eof") ||
		strings.Contains(errText, "connection reset") ||
		strings.Contains(errText, "connection refused") ||
		strings.Contains(errText, "timeout")
}

// GSAValidateHeaders contains headers used by the /validate request
type GSAValidateHeaders struct {
	// Required/primary headers
	SecurityCode        string // Security-Code
	XAppleIClientTime   string // X-Apple-I-Client-Time (RFC3339)
	XAppleIMd           string // X-Apple-I-Md
	XAppleIMdM          string // X-Apple-I-Md-M
	XAppleIMdLu         string // X-Apple-I-Md-Lu
	XAppleIMdRInfo      string // X-Apple-I-Md-Rinfo
	XAppleITimeZone     string // X-Apple-I-Timezone
	XAppleIdentityToken string // X-Apple-Identity-Token (base64)
	XMMEClientInfo      string // X-Mme-Client-Info
	XMMEDeviceID        string // X-Mme-Device-Id

	// Optional/aux headers
	AcceptLanguage string // Accept-Language (default: en-us)
	XAppleLocale   string // X-Apple-Locale (default: en_GB)
	UserAgent      string // User-Agent (default: iCloud.exe ...)
}

// GSAValidateBody is the XML plist body returned by /validate
type GSAValidateBody struct {
	EC       int    `plist:"ec"`
	EM       string `plist:"em"`
	ATXID    string `plist:"atxid"`
	IDMSData string `plist:"idmsdata"`
}

// GSAValidateResult aggregates headers and parsed body
type GSAValidateResult struct {
	Body     GSAValidateBody
	RawPlist []byte
	// Selected response headers
	HBToken             string // X-Apple-HB-Token
	PEToken             string // X-Apple-PE-Token
	SessionKey          string // X-Apple-Session-Key
	IEDPPV              string // X-Apple-I-EDP-PV
	IdentityToken       string // X-Apple-Identity-Token
	EncryptedSessionKey string // X-Apple-Encrypted-Session-Key
	ICK                 string // X-Apple-I-CK
	RespHeaders         http.Header
}

// GetGSAValidate performs GET /grandslam/GsService2/validate and parses headers/body
func GetGSAValidate(hdr GSAValidateHeaders) (*GSAValidateResult, error) {
	validateURL := gsaServiceURL + "/validate"

	// Defaults
	ua := hdr.UserAgent
	if strings.TrimSpace(ua) == "" {
		ua = "iCloud.exe (unknown version) CFNetwork/520.46"
	}
	acceptLang := hdr.AcceptLanguage
	if strings.TrimSpace(acceptLang) == "" {
		acceptLang = "en-us"
	}
	xLocale := hdr.XAppleLocale
	if strings.TrimSpace(xLocale) == "" {
		xLocale = "en_GB"
	}
	clientTime := hdr.XAppleIClientTime
	if strings.TrimSpace(clientTime) == "" {
		clientTime = time.Now().UTC().Format(time.RFC3339)
	}

	// HTTP client (match other GSA calls)
	tr := &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	client := &http.Client{Timeout: 60 * time.Second, Transport: tr}

	req, err := http.NewRequest("GET", validateURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Required headers
	if strings.TrimSpace(hdr.SecurityCode) != "" {
		req.Header.Set("Security-Code", hdr.SecurityCode)
	}
	req.Header.Set("X-Apple-I-Client-Time", clientTime)
	if strings.TrimSpace(hdr.XAppleIMd) != "" {
		req.Header.Set("X-Apple-I-Md", hdr.XAppleIMd)
	}
	if strings.TrimSpace(hdr.XAppleIMdM) != "" {
		req.Header.Set("X-Apple-I-Md-M", hdr.XAppleIMdM)
	}
	if strings.TrimSpace(hdr.XAppleIMdLu) != "" {
		req.Header.Set("X-Apple-I-Md-Lu", hdr.XAppleIMdLu)
	}
	if strings.TrimSpace(hdr.XAppleIMdRInfo) != "" {
		req.Header.Set("X-Apple-I-Md-Rinfo", hdr.XAppleIMdRInfo)
	}
	if strings.TrimSpace(hdr.XAppleITimeZone) != "" {
		req.Header.Set("X-Apple-I-Timezone", hdr.XAppleITimeZone)
	}
	if strings.TrimSpace(hdr.XAppleIdentityToken) != "" {
		req.Header.Set("X-Apple-Identity-Token", hdr.XAppleIdentityToken)
	}
	if strings.TrimSpace(hdr.XMMEClientInfo) != "" {
		req.Header.Set("X-Mme-Client-Info", hdr.XMMEClientInfo)
	}
	if strings.TrimSpace(hdr.XMMEDeviceID) != "" {
		req.Header.Set("X-Mme-Device-Id", hdr.XMMEDeviceID)
	}

	// For 2FA validation, AltStore uses Xcode + buddyml/plist headers.
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "application/x-buddyml")
	req.Header.Set("Accept-Language", acceptLang)
	req.Header.Set("Content-Type", "application/x-plist")
	if strings.TrimSpace(xLocale) != "" {
		req.Header.Set("X-Apple-Locale", xLocale)
	}

	logger.Debug().Str("url", validateURL).Str("user_agent", ua).Str("accept_language", acceptLang).Msg("GSA Validate Request")
	logger.Debug().Interface("headers", req.Header).Msg("GSA Validate Request headers")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	logger.Debug().Str("status", resp.Status).Interface("headers", resp.Header).Msg("GSA Validate Response headers")

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	if shouldDumpGSAPlist() {
		logger.Debug().Int("body_len", len(respBody)).Str("response_body", string(respBody)).Msg("GSA apptokens response plist")
	}
	if shouldDumpGSAPlist() {
		logger.Debug().Int("body_len", len(respBody)).Str("response_body", string(respBody)).Msg("GSA validate response plist")
	}

	var body GSAValidateBody
	if _, err := plist.Unmarshal(respBody, &body); err != nil {
		return nil, fmt.Errorf("failed to unmarshal validate body: %w", err)
	}

	logger.Debug().Int("ec", body.EC).Str("em", body.EM).Int("body_len", len(respBody)).Msg("GSA Validate Response")

	res := &GSAValidateResult{
		Body:                body,
		RawPlist:            respBody,
		RespHeaders:         resp.Header,
		HBToken:             resp.Header.Get("X-Apple-HB-Token"),
		PEToken:             resp.Header.Get("X-Apple-PE-Token"),
		SessionKey:          resp.Header.Get("X-Apple-Session-Key"),
		IEDPPV:              resp.Header.Get("X-Apple-I-EDP-PV"),
		IdentityToken:       resp.Header.Get("X-Apple-Identity-Token"),
		EncryptedSessionKey: resp.Header.Get("X-Apple-Encrypted-Session-Key"),
		ICK:                 resp.Header.Get("X-Apple-I-CK"),
	}

	return res, nil
}

// GSARequestCPD represents the Client Provided Data
// Must match Sidestore's clientDictionary exactly (ALTAppleAPI+Authentication.swift lines 38-54)
type GSARequestCPD struct {
	// Required fields matching Sidestore's clientDictionary
	BootStrap    bool   `plist:"bootstrap"`
	ICSCrec      bool   `plist:"icscrec"`
	PBE          bool   `plist:"pbe"`
	PRKGEN       bool   `plist:"prkgen"`
	SVCT         string `plist:"svct"`
	Loc          string `plist:"loc"`
	XAppleLocale string `plist:"X-Apple-Locale"`
	IMD          string `plist:"X-Apple-I-MD"`
	IMDM         string `plist:"X-Apple-I-MD-M"`
	UDID         string `plist:"X-Mme-Device-Id"`
	IMDLU        string `plist:"X-Apple-I-MD-LU"`
	RInfo        uint64 `plist:"X-Apple-I-MD-RINFO"` // Must be uint64 to match SideStore's NSUInteger (unsigned long long)
	SerialNumber string `plist:"X-Apple-I-SRL-NO"`
	ClientTime   string `plist:"X-Apple-I-Client-Time"`
	TimeZone     string `plist:"X-Apple-I-TimeZone"`

	// Additional fields used in your existing code
	CID   string `plist:"AppleIDClientIdentifier,omitempty"`
	CKGen bool   `plist:"ckgen,omitempty"`
	CApp  string `plist:"capp,omitempty"`
	DC    string `plist:"dc,omitempty"`
	DEC   string `plist:"dec,omitempty"`
	PApp  string `plist:"papp,omitempty"`
	PRTN  string `plist:"prtn,omitempty"`
}

// GSAStep1Request represents the first step request
type GSAStep1Request struct {
	A2K        []byte         `plist:"A2k"`
	Operation  string         `plist:"o"`
	ProtoStyle []string       `plist:"ps"`
	UserName   string         `plist:"u"`
	CPD        *GSARequestCPD `plist:"cpd"`
}

// GSAStatus represents the status response
type GSAStatus struct {
	StatusCode       int    `plist:"hsc"`
	ErrorDescription string `plist:"ed"`
	ErrorCode        int    `plist:"ec"`
	ErrorMessage     string `plist:"em"`
	AuthType         string `plist:"au"`
}

// GSAStep1Response represents the first step response
type GSAStep1Response struct {
	Status         GSAStatus `plist:"Status"`
	IterationCount int       `plist:"i"`
	Salt           []byte    `plist:"s"`
	ServerProto    string    `plist:"sp"`
	Complete       string    `plist:"c"`
	SRPB           []byte    `plist:"B"`
}

// GSAStep2Request represents the second step request
type GSAStep2Request struct {
	M1        []byte        `plist:"M1"`
	Complete  string        `plist:"c"`
	Operation string        `plist:"o"`
	UserName  string        `plist:"u"`
	CPD       GSARequestCPD `plist:"cpd"`
}

// GSAStep2Response represents the second step response
type GSAStep2Response struct {
	Status GSAStatus `plist:"Status"`
	SPD    []byte    `plist:"spd"`
	M2     []byte    `plist:"M2"`
	NP     []byte    `plist:"np"`
}

// ReqVersion represents the request version
type ReqVersion struct {
	Version string `plist:"Version"`
}

type GSAApptokensRequest struct {
	App       []string      `plist:"app"`
	C         []byte        `plist:"c"`
	Checksum  []byte        `plist:"checksum"`
	CPD       GSARequestCPD `plist:"cpd"`
	Operation string        `plist:"o"`
	Token     string        `plist:"t"`
	User      string        `plist:"u"`
}

// GSAHeaders optional headers influenced by Anisette data
type GSAHeaders struct {
	XMMEClientInfo string
	AcceptLanguage string
	XAppleLocale   string
	XAppleTimeZone string
}

// PostLoginStep1Request sends the first login step request
func PostLoginStep1Request(req *GSAStep1Request, hdr GSAHeaders) (*GSAStep1Response, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}

	type Request struct {
		Header  ReqVersion       `plist:"Header"`
		Request *GSAStep1Request `plist:"Request"`
	}

	var request Request
	request.Header.Version = "1.0.1"
	request.Request = req

	body, err := plist.MarshalIndent(&request, plist.XMLFormat, "\t")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal plist: %w", err)
	}
	if shouldDumpGSAPlist() {
		logger.Debug().Int("body_len", len(body)).Str("request_body", string(body)).Msg("GSA apptokens request plist")
	}
	if shouldDumpGSAPlist() {
		logger.Debug().Int("body_len", len(body)).Str("request_body", string(body)).Msg("GSA step1 request plist")
	}

	if req.CPD != nil {
		logger.Debug().Str("url", gsaServiceURL).Str("operation", req.Operation).Str("username", req.UserName).Interface("proto_styles", req.ProtoStyle).Int("a2k_len", len(req.A2K)).Str("cid", req.CPD.CID).Str("client_time", req.CPD.ClientTime).Str("device_id", req.CPD.UDID).Bool("bootstrap", req.CPD.BootStrap).Bool("ckgen", req.CPD.CKGen).Msg("GSA Step1 Request")
	} else {
		logger.Debug().Str("url", gsaServiceURL).Str("operation", req.Operation).Str("username", req.UserName).Interface("proto_styles", req.ProtoStyle).Int("a2k_len", len(req.A2K)).Msg("GSA Step1 Request")
	}

	// Create client with TLS config to skip certificate verification
	tr := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Timeout:   60 * time.Second,
		Transport: tr,
	}

	buildRequest := func() (*http.Request, error) {
		httpReq, err := http.NewRequest("POST", gsaServiceURL, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		// Match Sidestore's sendAuthenticationRequest headers exactly (only 4 headers!)
		httpReq.Header.Set("Content-Type", "text/x-xml-plist")
		if strings.TrimSpace(hdr.XMMEClientInfo) != "" {
			httpReq.Header.Set("X-MMe-Client-Info", hdr.XMMEClientInfo)
		}
		httpReq.Header.Set("Accept", "*/*")
		httpReq.Header.Set("User-Agent", "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0")
		return httpReq, nil
	}

	resp, err := doGSARequestWithRetry(client, buildRequest, "step1")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	type Response struct {
		Response *GSAStep1Response `plist:"Response"`
	}

	var response Response
	_, err = plist.Unmarshal(respBody, &response)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if response.Response != nil {
		logEvent := logger.Debug().Int("status_code", response.Response.Status.StatusCode).Int("error_code", response.Response.Status.ErrorCode)
		if response.Response.Status.ErrorMessage != "" {
			logEvent = logEvent.Str("error_message", response.Response.Status.ErrorMessage)
		}
		logEvent.Str("server_proto", response.Response.ServerProto).Int("iteration", response.Response.IterationCount).Int("salt_len", len(response.Response.Salt)).Int("server_b_len", len(response.Response.SRPB)).Str("session_ctx", response.Response.Complete).Msg("GSA Step1 Response")
	}

	return response.Response, nil
}

func PostGSAApptokensRequest(req *GSAApptokensRequest, hdr GSAValidateHeaders) (map[string]interface{}, error) {
	type Request struct {
		Header  map[string]string    `plist:"Header"`
		Request *GSAApptokensRequest `plist:"Request"`
	}

	var request Request
	request.Header = map[string]string{"Version": "1.0.1"}
	request.Request = req

	body, err := plist.MarshalIndent(&request, plist.XMLFormat, "\t")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal plist: %w", err)
	}

	tr := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Timeout:   60 * time.Second,
		Transport: tr,
	}

	httpReq, err := http.NewRequest("POST", gsaServiceURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("User-Agent", "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0")
	httpReq.Header.Set("Content-Type", "text/x-xml-plist")
	httpReq.Header.Set("Accept", "*/*")
	if strings.TrimSpace(hdr.XMMEClientInfo) != "" {
		httpReq.Header.Set("X-MMe-Client-Info", hdr.XMMEClientInfo)
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	type Response struct {
		Response map[string]interface{} `plist:"Response"`
	}

	var response Response
	_, err = plist.Unmarshal(respBody, &response)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	logger.Debug().
		Interface("response_keys", func() []string {
			keys := make([]string, 0, len(response.Response))
			for k := range response.Response {
				keys = append(keys, k)
			}
			return keys
		}()).
		Msg("GSA request response received")

	return response.Response, nil
}

// PostGSARequest sends a generic request to GSA service and returns parsed response
// Used for apptokens and other custom GSA requests
func PostGSARequest(params map[string]interface{}, hdr GSAValidateHeaders) (map[string]interface{}, error) {
	type Request struct {
		Header  map[string]string      `plist:"Header"`
		Request map[string]interface{} `plist:"Request"`
	}

	var request Request
	request.Header = map[string]string{"Version": "1.0.1"}
	request.Request = params

	body, err := plist.MarshalIndent(&request, plist.XMLFormat, "\t")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal plist: %w", err)
	}

	// Debug: Log request body preview (longer to see cpd)
	bodyPreview := string(body)
	if len(bodyPreview) > 3000 {
		bodyPreview = bodyPreview[:3000] + "..."
	}
	logger.Debug().
		Str("url", gsaServiceURL).
		Interface("operation", params["o"]).
		Str("X-MMe-Client-Info", hdr.XMMEClientInfo).
		Str("request_body_preview", bodyPreview).
		Msg("Sending GSA request")

	tr := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Timeout:   60 * time.Second,
		Transport: tr,
	}

	httpReq, err := http.NewRequest("POST", gsaServiceURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Match Sidestore's sendAuthenticationRequest headers exactly (lines 385-390)
	// Only set these 4 headers - Anisette data is already in cpd, don't duplicate in HTTP headers
	httpReq.Header.Set("User-Agent", "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0")
	httpReq.Header.Set("Content-Type", "text/x-xml-plist")
	httpReq.Header.Set("Accept", "*/*")
	if strings.TrimSpace(hdr.XMMEClientInfo) != "" {
		httpReq.Header.Set("X-MMe-Client-Info", hdr.XMMEClientInfo)
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	type Response struct {
		Response map[string]interface{} `plist:"Response"`
	}

	var response Response
	_, err = plist.Unmarshal(respBody, &response)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	logger.Debug().
		Interface("response_keys", func() []string {
			keys := make([]string, 0, len(response.Response))
			for k := range response.Response {
				keys = append(keys, k)
			}
			return keys
		}()).
		Msg("GSA request response received")

	return response.Response, nil
}

// PostLoginStep2Request sends the second login step request
func PostLoginStep2Request(req *GSAStep2Request, hdr GSAHeaders) (*GSAStep2Response, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}

	type Request struct {
		Header  ReqVersion       `plist:"Header"`
		Request *GSAStep2Request `plist:"Request"`
	}

	var request Request
	request.Header.Version = "1.0.1"
	request.Request = req

	body, err := plist.MarshalIndent(&request, plist.XMLFormat, "\t")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal plist: %w", err)
	}

	logger.Debug().Str("url", gsaServiceURL).Str("operation", req.Operation).Str("username", req.UserName).Int("m1_len", len(req.M1)).Str("session_ctx", req.Complete).Msg("GSA Step2 Request")

	// Create client with TLS config to skip certificate verification
	tr := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Timeout:   60 * time.Second,
		Transport: tr,
	}

	buildRequest := func() (*http.Request, error) {
		httpReq, err := http.NewRequest("POST", gsaServiceURL, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		// Match Sidestore's sendAuthenticationRequest headers exactly (only 4 headers!)
		httpReq.Header.Set("Content-Type", "text/x-xml-plist")
		if strings.TrimSpace(hdr.XMMEClientInfo) != "" {
			httpReq.Header.Set("X-MMe-Client-Info", hdr.XMMEClientInfo)
		}
		httpReq.Header.Set("Accept", "*/*")
		httpReq.Header.Set("User-Agent", "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0")

		logger.Debug().Interface("headers", httpReq.Header).Msg("GSA Step2 Request headers")
		return httpReq, nil
	}

	resp, err := doGSARequestWithRetry(client, buildRequest, "step2")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	logger.Debug().Str("status", resp.Status).Interface("headers", resp.Header).Msg("GSA Step2 Response headers")

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	type Response struct {
		Response *GSAStep2Response `plist:"Response"`
	}

	var response Response
	_, err = plist.Unmarshal(respBody, &response)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if response.Response != nil {
		logEvent := logger.Debug().Int("status_code", response.Response.Status.StatusCode).Int("error_code", response.Response.Status.ErrorCode)
		if response.Response.Status.ErrorMessage != "" {
			logEvent = logEvent.Str("error_message", response.Response.Status.ErrorMessage)
		}
		logEvent = logEvent.Int("m2_len", len(response.Response.M2)).Int("spd_len", len(response.Response.SPD))
		if len(response.Response.NP) > 0 {
			logEvent = logEvent.Int("np_len", len(response.Response.NP))
		}
		logEvent.Msg("GSA Step2 Response")
	}

	return response.Response, nil
}
