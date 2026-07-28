package store

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"ipaget-service/internal/logger"
	"net/http"
	"time"

	"howett.net/plist"
)

// SPDData represents the decrypted SPD token data from GSA
type SPDData struct {
	ADSID         string `plist:"adsid"`         // Apple ID Session ID
	GsIdmsToken   string `plist:"GsIdmsToken"`   // Token for IDMS
	DelegateToken string `plist:"DelegateToken"` // Delegate token
	TrustToken    []byte `plist:"t"`             // Trust token
	PrimaryEmail  string `plist:"apple-id"`      // Primary Apple ID email
	FirstName     string `plist:"first-name"`    // User's first name
	LastName      string `plist:"last-name"`     // User's last name
	SessionKey    []byte `plist:"sk"`            // Session key for app token encryption
	C             []byte `plist:"c"`             // Challenge for app token request
}

// AppStoreAuthResponse represents the response from App Store authentication
type AppStoreAuthResponse struct {
	PasswordToken       string `json:"passwordToken"`
	DirectoryServicesID string `json:"directoryServicesId"`
	AccountName         string `json:"accountName"`
	FirstName           string `json:"firstName"`
	LastName            string `json:"lastName"`
	Storefront          string `json:"storefront"`
	StorefrontID        string `json:"storefrontId"`
}

// ParseSPDToken parses the decrypted SPD token (plist format) and extracts key information
func ParseSPDToken(spdBytes []byte) (*SPDData, error) {
	if len(spdBytes) == 0 {
		return nil, fmt.Errorf("SPD token is empty")
	}

	// First, parse as generic map to inspect structure
	var rawData map[string]interface{}
	_, err := plist.Unmarshal(spdBytes, &rawData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse SPD plist: %w", err)
	}

	// Debug: Log all keys and their types in SPD
	keyTypes := make(map[string]string)
	for k, v := range rawData {
		keyTypes[k] = fmt.Sprintf("%T", v)
	}
	logger.Logger.Debug().
		Interface("spd_key_types", keyTypes).
		Msg("SPD parsed - field types")

	// Extract fields manually to avoid type mismatches
	spd := &SPDData{}

	if adsid, ok := rawData["adsid"].(string); ok {
		spd.ADSID = adsid
	}
	if gsToken, ok := rawData["GsIdmsToken"].(string); ok {
		spd.GsIdmsToken = gsToken
	}
	if delegateToken, ok := rawData["DelegateToken"].(string); ok {
		spd.DelegateToken = delegateToken
	}
	if email, ok := rawData["apple-id"].(string); ok {
		spd.PrimaryEmail = email
	}
	if firstName, ok := rawData["first-name"].(string); ok {
		spd.FirstName = firstName
	}
	if lastName, ok := rawData["last-name"].(string); ok {
		spd.LastName = lastName
	}
	// TrustToken might be []byte or Data type, handle carefully
	if trustToken, ok := rawData["t"].([]byte); ok {
		spd.TrustToken = trustToken
	}
	// Session key for app token encryption
	if skVal, exists := rawData["sk"]; exists {
		switch v := skVal.(type) {
		case []byte:
			spd.SessionKey = v
			logger.Logger.Debug().
				Int("sk_len", len(v)).
				Str("sk_type", "[]byte").
				Str("sk_hex_prefix", fmt.Sprintf("%x", v[:min(8, len(v))])).
				Msg("SPD 'sk' field parsed as []byte")
		case string:
			// sk should be binary, but check if it's base64 encoded string
			spd.SessionKey = []byte(v)
			logger.Logger.Warn().
				Int("sk_len", len(v)).
				Str("sk_type", "string").
				Msg("SPD 'sk' field is STRING - may need base64 decode!")
		default:
			logger.Logger.Error().
				Str("sk_type", fmt.Sprintf("%T", skVal)).
				Msg("SPD 'sk' field has unexpected type")
		}
	} else {
		logger.Logger.Warn().Msg("SPD does not contain 'sk' field")
	}
	// Challenge for app token request - might be []byte or string!
	if cVal, exists := rawData["c"]; exists {
		switch v := cVal.(type) {
		case []byte:
			spd.C = v
			// Check if the []byte content looks like ASCII text (UUID string)
			isAsciiText := true
			for _, b := range v[:min(36, len(v))] {
				if b < 0x20 || b > 0x7e {
					isAsciiText = false
					break
				}
			}
			logger.Logger.Debug().
				Int("c_len", len(v)).
				Str("c_type", "[]byte").
				Bool("c_looks_like_ascii", isAsciiText).
				Str("c_hex_prefix", fmt.Sprintf("%x", v[:min(32, len(v))])).
				Str("c_as_string_prefix", string(v[:min(48, len(v))])).
				Msg("SPD 'c' field parsed as []byte")
		case string:
			// c is a string - convert to []byte
			spd.C = []byte(v)
			logger.Logger.Warn().
				Int("c_len", len(v)).
				Str("c_type", "string").
				Str("c_value", v[:min(64, len(v))]).
				Msg("SPD 'c' field is STRING type - converting to []byte")
		default:
			logger.Logger.Error().
				Str("c_type", fmt.Sprintf("%T", cVal)).
				Interface("c_value", cVal).
				Msg("SPD 'c' field has unexpected type")
		}
	} else {
		logger.Logger.Warn().Msg("SPD does not contain 'c' field")
	}

	if spd.ADSID == "" {
		return nil, fmt.Errorf("SPD token missing adsid")
	}

	return spd, nil
}

// ExchangeGSATokenForAppStore exchanges GSA SPD token for App Store credentials
// This mimics what SideStore/AltStore does to convert GSA auth into App Store session
func ExchangeGSATokenForAppStore(spdData *SPDData, deviceMeta *DeviceMetadata) (*AppStoreAuthResponse, error) {
	if spdData == nil || spdData.ADSID == "" {
		return nil, fmt.Errorf("invalid SPD data: missing adsid")
	}

	// Create HTTP client with custom transport (similar to GSA requests)
	tr := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   30 * time.Second,
	}

	// Prepare the authentication request payload
	// This is based on how SideStore/AltStore authenticates with App Store using GSA token
	payload := map[string]interface{}{
		"apple-id":              spdData.PrimaryEmail,
		"attempt":               1,
		"createSession":         true,
		"guid":                  deviceMeta.UDID,
		"password":              spdData.ADSID, // Use ADSID as password for token-based auth
		"why":                   "signIn",
		"X-Apple-I-MD":          deviceMeta.IMD,
		"X-Apple-I-MD-M":        deviceMeta.IMDM,
		"X-Mme-Device-Id":       deviceMeta.UDID,
		"X-Apple-I-Client-Time": time.Now().UTC().Format(time.RFC3339),
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Make request to App Store authentication endpoint
	req, err := http.NewRequest("POST", "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate", bytes.NewReader(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers (similar to what ipatool does)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8")
	req.Header.Set("X-Apple-I-MD", deviceMeta.IMD)
	req.Header.Set("X-Apple-I-MD-M", deviceMeta.IMDM)
	req.Header.Set("X-Mme-Device-Id", deviceMeta.UDID)
	req.Header.Set("X-Mme-Client-Info", deviceMeta.CID)
	req.Header.Set("X-Apple-I-Client-Time", time.Now().UTC().Format(time.RFC3339))

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("authentication request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("authentication failed with status %d: %s", resp.StatusCode, string(body))
	}

	// Parse the response
	var authResp AppStoreAuthResponse
	err = json.Unmarshal(body, &authResp)
	if err != nil {
		// Try plist format as fallback
		_, err2 := plist.Unmarshal(body, &authResp)
		if err2 != nil {
			return nil, fmt.Errorf("failed to parse response (tried JSON and plist): %w / %w", err, err2)
		}
	}

	if authResp.PasswordToken == "" || authResp.DirectoryServicesID == "" {
		return nil, fmt.Errorf("authentication response missing required fields")
	}

	return &authResp, nil
}

// ConvertGSATokenToAppStoreAccount converts GSA SPD token to an appstore.Account format
// that can be used with the existing ipatool-compatible code
func ConvertGSATokenToAppStoreAccount(spdBytes []byte, deviceMeta *DeviceMetadata, email string) (map[string]interface{}, error) {
	// Parse SPD token
	spdData, err := ParseSPDToken(spdBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse SPD token: %w", err)
	}

	// Exchange for App Store credentials
	authResp, err := ExchangeGSATokenForAppStore(spdData, deviceMeta)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange GSA token: %w", err)
	}

	// Create account structure compatible with ipatool's appstore.Account
	account := map[string]interface{}{
		"email":                 email,
		"password_token":        authResp.PasswordToken,
		"directory_services_id": authResp.DirectoryServicesID,
		"first_name":            authResp.FirstName,
		"last_name":             authResp.LastName,
		"storefront":            authResp.Storefront,
		"storefront_id":         authResp.StorefrontID,
		"gsa_token":             spdData.ADSID,
		"gs_idms_token":         spdData.GsIdmsToken,
	}

	return account, nil
}
