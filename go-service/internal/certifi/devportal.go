package certifi

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"ipaget-service/internal/logger"
	"ipaget-service/internal/store"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"howett.net/plist"
)

const (
	ALTProtocolVersion = "QH65B2"
	ALTClientID        = "XABBG36SBA"
	BaseURL            = "https://developerservices2.apple.com/services/" + ALTProtocolVersion + "/"
	ServicesBaseURL    = "https://developerservices2.apple.com/services/v1/"

	// Apple API error codes
	ResultCodeSessionExpired = 1100
)

// SessionExpiredError indicates that the Apple Developer Portal session has expired
type SessionExpiredError struct {
	ResultCode int
	Message    string
}

func (e *SessionExpiredError) Error() string {
	return fmt.Sprintf("session expired (code %d): %s", e.ResultCode, e.Message)
}

type DevSession struct {
	DSID          string
	AuthToken     string
	AnisetteURL   string
	AnisetteCache *store.AnisetteData // Should contain the same Anisette data used during GSA authentication
}

type Team struct {
	TeamID   string
	TeamName string
	TeamType string // "free" or "paid"
}

type DevelopmentCertificate struct {
	ID           string
	SerialNumber string
	Name         string
	MachineName  string
	MachineID    string
	Data         []byte
}

type Device struct {
	DeviceID   string
	DeviceName string
	UDID       string
}

type AppID struct {
	AppIDID    string
	BundleID   string
	Name       string
	Identifier string
}

type DeveloperPortalClient interface {
	CreateSession(dsid, authToken, anisetteURL string, anisetteData *store.AnisetteData) *DevSession
	FetchAccount(sess *DevSession) error
	SelectPersonalTeam(sess *DevSession) (*Team, error)
	ListDevelopmentCertificates(sess *DevSession, team *Team) ([]DevelopmentCertificate, error)
	RevokeDevelopmentCertificate(sess *DevSession, team *Team, certificateID string) error
	EnsureAppID(sess *DevSession, team *Team, bundleID string) error
	CreateDevelopmentCertificate(sess *DevSession, team *Team, csrPEM []byte) (certDER []byte, expiresAt time.Time, commonName string, err error)
	EnsureProvisioningProfile(sess *DevSession, team *Team, bundleID string) (provisionData []byte, profileName string, err error)
	RegisterDevice(sess *DevSession, team *Team, deviceName, udid string) error
	DebugListAppIdentifiers(sess *DevSession, team *Team) ([]string, error)
}

func NewDeveloperPortalClient() DeveloperPortalClient {
	return &appleDevPortalClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// CreateSession creates a developer portal session from existing GSA credentials
// The anisetteData should be the same data used during GSA authentication to ensure consistency
func (c *appleDevPortalClient) CreateSession(dsid, authToken, anisetteURL string, anisetteData *store.AnisetteData) *DevSession {
	log := logger.Logger
	log.Debug().
		Str("dsid_preview", func() string {
			if len(dsid) > 20 {
				return dsid[:20] + "..."
			}
			return dsid
		}()).
		Str("token_preview", func() string {
			if len(authToken) > 30 {
				return authToken[:30] + "..."
			}
			return authToken
		}()).
		Str("anisette_url", anisetteURL).
		Bool("has_anisette_data", anisetteData != nil).
		Msg("Creating DevSession with cached Anisette data")

	if anisetteData != nil {
		log.Debug().
			Str("cached_client_time", anisetteData.ClientTime).
			Str("cached_device_id", anisetteData.DeviceID).
			Msg("Session will use cached Anisette data")
	}

	return &DevSession{
		DSID:          dsid,
		AuthToken:     authToken,
		AnisetteURL:   anisetteURL,
		AnisetteCache: anisetteData,
	}
}

type appleDevPortalClient struct {
	httpClient *http.Client
}

// getAnisetteData returns cached Anisette data from the session
// CRITICAL: Must use the same Anisette data that was used during GSA authentication
// to avoid session expired errors (resultCode 1100)
// DO NOT fetch new Anisette data here - it will cause session mismatch!
func (c *appleDevPortalClient) getAnisetteData(sess *DevSession) (*store.AnisetteData, error) {
	if sess.AnisetteCache != nil {
		log := logger.Logger
		log.Debug().
			Str("client_time", sess.AnisetteCache.ClientTime).
			Msg("Using cached Anisette data from session")
		return sess.AnisetteCache, nil
	}

	log := logger.Logger
	log.Error().Msg("No cached Anisette data in session - this will cause authentication failure")
	return nil, fmt.Errorf("AnisetteCache is nil: the Anisette data used during GSA authentication must be provided to maintain session consistency")
}

func (c *appleDevPortalClient) SelectPersonalTeam(sess *DevSession) (*Team, error) {
	log := logger.Logger
	log.Info().Msg("Fetching developer account before team selection")

	if err := c.FetchAccount(sess); err != nil {
		return nil, fmt.Errorf("failed to fetch developer account: %w", err)
	}

	log.Info().Msg("Fetching teams")

	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return nil, fmt.Errorf("failed to get anisette data: %w", err)
	}

	reqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
	}

	respData, err := c.sendDevPortalRequest("listTeams.action", reqBody, sess, anisetteData)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch teams from Developer Portal")
		return nil, fmt.Errorf("failed to fetch teams: %w", err)
	}

	teamsRaw, ok := respData["teams"]
	if !ok {
		log.Error().Interface("response", respData).Msg("Response does not contain 'teams' field")
		return nil, fmt.Errorf("invalid response: missing 'teams' field")
	}

	teams, ok := teamsRaw.([]interface{})
	if !ok {
		log.Error().Interface("teams_raw", teamsRaw).Str("type", fmt.Sprintf("%T", teamsRaw)).Msg("'teams' field is not an array")
		return nil, fmt.Errorf("invalid response: 'teams' field is not an array")
	}

	if len(teams) == 0 {
		return nil, fmt.Errorf("no teams found for account")
	}

	// Find personal team (free team)
	for _, t := range teams {
		teamDict := t.(map[string]interface{})
		teamType := teamDict["type"].(string)
		if teamType == "Individual" || teamType == "Company/Organization" {
			teamID := teamDict["teamId"].(string)
			teamName := teamDict["name"].(string)

			return &Team{
				TeamID:   teamID,
				TeamName: teamName,
				TeamType: "free",
			}, nil
		}
	}

	// Fallback to first team
	firstTeam := teams[0].(map[string]interface{})
	return &Team{
		TeamID:   firstTeam["teamId"].(string),
		TeamName: firstTeam["name"].(string),
		TeamType: "unknown",
	}, nil
}

func (c *appleDevPortalClient) FetchAccount(sess *DevSession) error {
	log := logger.Logger
	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return fmt.Errorf("failed to get anisette data: %w", err)
	}

	respData, err := c.sendDevPortalRequest("viewDeveloper.action", map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
	}, sess, anisetteData)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch developer account from Developer Portal")
		return err
	}

	if _, ok := respData["developer"]; !ok {
		log.Warn().Interface("response", respData).Msg("Developer Portal account response missing 'developer' field")
	}

	return nil
}

func (c *appleDevPortalClient) RegisterDevice(sess *DevSession, team *Team, deviceName, udid string) error {
	log := logger.Logger
	log.Info().Str("device_name", deviceName).Str("udid", udid).Msg("Registering device")

	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return fmt.Errorf("failed to get anisette data: %w", err)
	}

	reqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
		"teamId":          team.TeamID,
		"deviceNumber":    udid,
		"name":            deviceName,
		"DTDK_Platform":   "ios",
	}

	_, err = c.sendDevPortalRequest("ios/addDevice.action", reqBody, sess, anisetteData)
	if err != nil {
		// Device might already be registered
		if strings.Contains(err.Error(), "already exists") || strings.Contains(err.Error(), "resultCode\":35") {
			log.Info().Str("udid", udid).Msg("Device already registered")
			return nil
		}
		return fmt.Errorf("failed to register device: %w", err)
	}

	log.Info().Str("device_name", deviceName).Msg("Device registered successfully")
	return nil
}

func (c *appleDevPortalClient) EnsureAppID(sess *DevSession, team *Team, bundleID string) error {
	log := logger.Logger
	log.Info().Str("bundle_id", bundleID).Msg("Ensuring App ID exists")

	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return fmt.Errorf("failed to get anisette data: %w", err)
	}

	// First, try to list existing App IDs
	listReqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
		"teamId":          team.TeamID,
	}

	respData, err := c.sendDevPortalRequest("ios/listAppIds.action", listReqBody, sess, anisetteData)
	if err != nil {
		return fmt.Errorf("failed to list app IDs: %w", err)
	}

	// Check if App ID already exists
	if appIDs, ok := respData["appIds"].([]interface{}); ok {
		for _, appID := range appIDs {
			appIDDict := appID.(map[string]interface{})
			if identifier, ok := appIDDict["identifier"].(string); ok && identifier == bundleID {
				log.Info().Str("bundle_id", bundleID).Msg("App ID already exists")
				return nil
			}
		}
	}

	// App ID doesn't exist, create it
	createReqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
		"teamId":          team.TeamID,
		"identifier":      bundleID,
		"name":            "Free Sign App",
	}

	_, err = c.sendDevPortalRequest("ios/addAppId.action", createReqBody, sess, anisetteData)
	if err != nil {
		return fmt.Errorf("failed to create app ID: %w", err)
	}

	log.Info().Str("bundle_id", bundleID).Msg("App ID created successfully")
	return nil
}

func (c *appleDevPortalClient) DebugListAppIdentifiers(sess *DevSession, team *Team) ([]string, error) {
	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return nil, fmt.Errorf("failed to get anisette data: %w", err)
	}

	listReqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
		"teamId":          team.TeamID,
	}

	respData, err := c.sendDevPortalRequest("ios/listAppIds.action", listReqBody, sess, anisetteData)
	if err != nil {
		return nil, fmt.Errorf("failed to list app IDs: %w", err)
	}

	identifiers := make([]string, 0)
	if appIDs, ok := respData["appIds"].([]interface{}); ok {
		for _, appID := range appIDs {
			appIDDict, ok := appID.(map[string]interface{})
			if !ok {
				continue
			}
			if identifier, ok := appIDDict["identifier"].(string); ok && strings.TrimSpace(identifier) != "" {
				identifiers = append(identifiers, identifier)
			}
		}
	}

	return identifiers, nil
}

func (c *appleDevPortalClient) ListDevelopmentCertificates(sess *DevSession, team *Team) ([]DevelopmentCertificate, error) {
	log := logger.Logger
	log.Info().Str("team_id", team.TeamID).Msg("Listing development certificates")

	respData, err := c.sendServicesRequest(http.MethodGet, "certificates", map[string]string{
		"filter[certificateType]": "IOS_DEVELOPMENT",
	}, sess, team)
	if err != nil {
		return nil, fmt.Errorf("failed to list development certificates: %w", err)
	}

	itemsRaw, ok := respData["data"]
	if !ok {
		return []DevelopmentCertificate{}, nil
	}

	items, ok := itemsRaw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid certificates response: data is %T", itemsRaw)
	}

	certificates := make([]DevelopmentCertificate, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		attributes, _ := entry["attributes"].(map[string]interface{})
		certificate := DevelopmentCertificate{
			ID:           stringValue(entry["id"]),
			SerialNumber: stringValue(attributes["serialNumber"]),
			Name:         stringValue(attributes["name"]),
			MachineName:  stringValue(attributes["machineName"]),
			MachineID:    stringValue(attributes["machineId"]),
		}
		if certificate.SerialNumber == "" {
			certificate.SerialNumber = stringValue(attributes["serialNum"])
		}
		if content, contentErr := decodeCertificateContent(attributes); contentErr == nil {
			certificate.Data = content
		}

		certificates = append(certificates, certificate)
	}

	return certificates, nil
}

func (c *appleDevPortalClient) RevokeDevelopmentCertificate(sess *DevSession, team *Team, certificateID string) error {
	if certificateID == "" {
		return fmt.Errorf("certificate ID is required")
	}

	_, err := c.sendServicesRequest(http.MethodDelete, "certificates/"+url.PathEscape(certificateID), nil, sess, team)
	if err != nil {
		return fmt.Errorf("failed to revoke development certificate: %w", err)
	}

	return nil
}

func (c *appleDevPortalClient) CreateDevelopmentCertificate(sess *DevSession, team *Team, csrPEM []byte) ([]byte, time.Time, string, error) {
	log := logger.Logger
	log.Info().Msg("Creating development certificate")

	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("failed to get anisette data: %w", err)
	}

	csrContent := string(csrPEM)

	reqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
		"teamId":          team.TeamID,
		"csrContent":      csrContent,
		"machineId":       uuid.New().String(),
		"machineName":     "ipaget-service",
	}

	respData, err := c.sendDevPortalRequest("ios/submitDevelopmentCSR.action", reqBody, sess, anisetteData)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("failed to submit CSR: %w", err)
	}

	log.Debug().Interface("response_keys", mapValueTypes(respData)).Msg("Development certificate response received")

	certRequest, ok := respData["certRequest"].(map[string]interface{})
	if !ok {
		return nil, time.Time{}, "", fmt.Errorf("invalid certificate response: missing certRequest")
	}

	log.Debug().Interface("cert_request_keys", mapValueTypes(certRequest)).Msg("Parsed certRequest structure")

	var certDER []byte
	serialNumber := stringValue(certRequest["serialNum"])
	if serialNumber == "" {
		serialNumber = stringValue(certRequest["serialNumber"])
	}
	switch value := certRequest["certContent"].(type) {
	case []byte:
		certDER = value
	case string:
		certDER, err = base64.StdEncoding.DecodeString(value)
		if err != nil {
			return nil, time.Time{}, "", fmt.Errorf("failed to decode certificate content: %w", err)
		}
	case nil:
		if encoded, ok := certRequest["certificateContent"].(string); ok && encoded != "" {
			certDER, err = base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				return nil, time.Time{}, "", fmt.Errorf("failed to decode certificate content: %w", err)
			}
		}
	default:
		return nil, time.Time{}, "", fmt.Errorf("invalid certificate content type: %T", value)
	}

	if len(certDER) == 0 {
		log.Warn().Interface("cert_request", certRequest).Str("serial_number", serialNumber).Msg("Certificate response did not include certificate content; fetching from certificate list")

		certificates, listErr := c.ListDevelopmentCertificates(sess, team)
		if listErr != nil {
			return nil, time.Time{}, "", fmt.Errorf("invalid certificate response: empty certificate content and failed to list certificates: %w", listErr)
		}

		for _, listedCertificate := range certificates {
			if !strings.EqualFold(listedCertificate.SerialNumber, serialNumber) {
				continue
			}
			certDER = listedCertificate.Data
			break
		}

		if len(certDER) == 0 {
			return nil, time.Time{}, "", fmt.Errorf("invalid certificate response: empty certificate content")
		}
	}

	certDER, err = normalizeCertificateData(certDER)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("failed to normalize certificate: %w", err)
	}

	// Parse certificate to get expiry and common name
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("failed to parse certificate: %w", err)
	}

	log.Info().Str("common_name", cert.Subject.CommonName).Time("expires_at", cert.NotAfter).Msg("Certificate created successfully")
	return certDER, cert.NotAfter, cert.Subject.CommonName, nil
}

func (c *appleDevPortalClient) EnsureProvisioningProfile(sess *DevSession, team *Team, bundleID string) ([]byte, string, error) {
	log := logger.Logger
	log.Info().Str("bundle_id", bundleID).Msg("Ensuring provisioning profile")

	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return nil, "", fmt.Errorf("failed to get anisette data: %w", err)
	}

	// First get the App ID internal ID
	listReqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
		"teamId":          team.TeamID,
	}

	respData, err := c.sendDevPortalRequest("ios/listAppIds.action", listReqBody, sess, anisetteData)
	if err != nil {
		return nil, "", fmt.Errorf("failed to list app IDs: %w", err)
	}

	var appIDID string
	if appIDs, ok := respData["appIds"].([]interface{}); ok {
		for _, appID := range appIDs {
			appIDDict := appID.(map[string]interface{})
			if identifier, ok := appIDDict["identifier"].(string); ok && identifier == bundleID {
				appIDID = appIDDict["appIdId"].(string)
				break
			}
		}
	}

	if appIDID == "" {
		return nil, "", fmt.Errorf("app ID not found for bundle: %s", bundleID)
	}

	// Download provisioning profile
	downloadReqBody := map[string]interface{}{
		"clientId":        ALTClientID,
		"protocolVersion": ALTProtocolVersion,
		"requestId":       strings.ToUpper(uuid.New().String()),
		"teamId":          team.TeamID,
		"appIdId":         appIDID,
		"DTDK_Platform":   "ios",
	}

	respData, err = c.sendDevPortalRequest("ios/downloadTeamProvisioningProfile.action", downloadReqBody, sess, anisetteData)
	if err != nil {
		return nil, "", fmt.Errorf("failed to download provisioning profile: %w", err)
	}

	provisioningProfile := respData["provisioningProfile"].(map[string]interface{})

	var encodedProfile string
	var provisionData []byte
	switch value := provisioningProfile["encodedProfile"].(type) {
	case string:
		encodedProfile = value
	case []byte:
		if maybeBase64 := string(value); maybeBase64 != "" {
			if decoded, decodeErr := base64.StdEncoding.DecodeString(maybeBase64); decodeErr == nil {
				provisionData = decoded
			} else {
				provisionData = value
			}
		}
	default:
		return nil, "", fmt.Errorf("invalid provisioning profile encoding type: %T", value)
	}

	profileName := ""
	if name, ok := provisioningProfile["name"].(string); ok {
		profileName = name
	}

	if len(provisionData) == 0 {
		decoded, err := base64.StdEncoding.DecodeString(encodedProfile)
		if err != nil {
			provisionData = []byte(encodedProfile)
		} else {
			provisionData = decoded
		}
	}

	if len(provisionData) == 0 {
		return nil, "", fmt.Errorf("provisioning profile payload is empty")
	}

	log.Info().Str("profile_name", profileName).Msg("Provisioning profile downloaded successfully")
	return provisionData, profileName, nil
}

// Helper functions

func (c *appleDevPortalClient) sendDevPortalRequest(action string, params map[string]interface{}, sess *DevSession, anisetteData *store.AnisetteData) (map[string]interface{}, error) {
	log := logger.Logger
	url := BaseURL + action + "?clientId=" + ALTClientID

	// Convert params to plist XML
	bodyData, err := marshalPlist(params)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal plist: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", "text/x-xml-plist")
	req.Header.Set("User-Agent", "Xcode")
	req.Header.Set("Accept", "text/x-xml-plist")
	req.Header.Set("Accept-Language", "en-us")
	req.Header.Set("X-Apple-App-Info", "com.apple.gs.xcode.auth")
	req.Header.Set("X-Xcode-Version", "11.2 (11B41)")
	req.Header.Set("X-Apple-I-Identity-Id", sess.DSID)
	req.Header.Set("X-Apple-GS-Token", sess.AuthToken)

	tokenPreview := sess.AuthToken
	if len(sess.AuthToken) > 30 {
		tokenPreview = sess.AuthToken[:30] + "..."
	}

	log.Debug().
		Str("dsid", sess.DSID).
		Str("token_prefix", tokenPreview).
		Str("action", action).
		Msg("Sending Developer Portal request")

	req.Header.Set("X-Apple-I-MD-M", anisetteData.MDM)
	req.Header.Set("X-Apple-I-MD", anisetteData.MD)
	req.Header.Set("X-Apple-I-MD-LU", anisetteData.MDLU)
	req.Header.Set("X-Apple-I-MD-RINFO", anisetteData.MDRINFO)
	req.Header.Set("X-Mme-Device-Id", anisetteData.DeviceID)
	req.Header.Set("X-MMe-Client-Info", anisetteData.ClientInfo)
	req.Header.Set("X-Apple-I-Client-Time", anisetteData.ClientTime)
	req.Header.Set("X-Apple-Locale", anisetteData.Locale)
	req.Header.Set("X-Apple-I-Locale", anisetteData.Locale)
	req.Header.Set("X-Apple-I-TimeZone", anisetteData.TimeZone)

	log.Debug().
		Str("action", action).
		Str("x_apple_i_identity_id", req.Header.Get("X-Apple-I-Identity-Id")).
		Str("x_apple_gs_token_preview", func() string {
			token := req.Header.Get("X-Apple-GS-Token")
			if len(token) > 30 {
				return token[:30] + "..."
			}
			return token
		}()).
		Str("x_mme_device_id", anisetteData.DeviceID).
		Str("x_apple_i_client_time", anisetteData.ClientTime).
		Msg("Request headers set")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	respData, err := unmarshalPlist(respBody)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	// Check for errors
	// resultCode might be int, int64, uint64, or float64 depending on plist encoding
	var resultCode int
	resultCodeFound := false

	// Debug: log the actual type of resultCode
	if rcVal, exists := respData["resultCode"]; exists {
		log.Debug().
			Str("result_code_type", fmt.Sprintf("%T", rcVal)).
			Interface("result_code_value", rcVal).
			Str("action", action).
			Msg("Found resultCode in response")

		if rc, ok := rcVal.(int); ok {
			resultCode = rc
			resultCodeFound = true
		} else if rc, ok := rcVal.(int64); ok {
			resultCode = int(rc)
			resultCodeFound = true
		} else if rc, ok := rcVal.(uint64); ok {
			resultCode = int(rc)
			resultCodeFound = true
		} else if rc, ok := rcVal.(float64); ok {
			resultCode = int(rc)
			resultCodeFound = true
		} else {
			log.Error().
				Str("result_code_type", fmt.Sprintf("%T", rcVal)).
				Interface("result_code_value", rcVal).
				Str("action", action).
				Msg("Unknown resultCode type, cannot parse")
		}
	} else {
		log.Debug().
			Str("action", action).
			Msg("No resultCode field in response")
	}

	if resultCodeFound {
		log.Debug().
			Int("result_code", resultCode).
			Str("action", action).
			Msg("Parsed resultCode successfully")
	}

	if resultCode != 0 {
		userString := ""
		if us, ok := respData["userString"].(string); ok {
			userString = us
		}

		// Check if this is a session expired error
		if resultCode == ResultCodeSessionExpired {
			log.Error().
				Int("result_code", resultCode).
				Str("user_string", userString).
				Str("action", action).
				Msg("Apple Developer Portal session expired")
			return nil, &SessionExpiredError{
				ResultCode: resultCode,
				Message:    userString,
			}
		}

		log.Error().
			Int("result_code", resultCode).
			Str("user_string", userString).
			Str("action", action).
			Msg("Apple Developer Portal API error")
		return nil, fmt.Errorf("apple api error (code %d): %s", resultCode, userString)
	}

	return respData, nil
}

func (c *appleDevPortalClient) sendServicesRequest(method string, path string, queryParams map[string]string, sess *DevSession, team *Team) (map[string]interface{}, error) {
	log := logger.Logger
	requestURL := ServicesBaseURL + path

	form := url.Values{}
	form.Set("teamId", team.TeamID)
	for key, value := range queryParams {
		form.Set(key, value)
	}

	payload, err := json.Marshal(map[string]string{
		"urlEncodedQueryParams": form.Encode(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal services request body: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, requestURL, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to create services request: %w", err)
	}

	req.Header.Set("Content-Type", "application/vnd.api+json")
	req.Header.Set("User-Agent", "Xcode")
	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Accept-Language", "en-us")
	req.Header.Set("X-Apple-App-Info", "com.apple.gs.xcode.auth")
	req.Header.Set("X-Xcode-Version", "11.2 (11B41)")
	req.Header.Set("X-HTTP-Method-Override", method)
	req.Header.Set("X-Apple-I-Identity-Id", sess.DSID)
	req.Header.Set("X-Apple-GS-Token", sess.AuthToken)

	anisetteData, err := c.getAnisetteData(sess)
	if err != nil {
		return nil, fmt.Errorf("failed to get anisette data: %w", err)
	}

	req.Header.Set("X-Apple-I-MD-M", anisetteData.MDM)
	req.Header.Set("X-Apple-I-MD", anisetteData.MD)
	req.Header.Set("X-Apple-I-MD-LU", anisetteData.MDLU)
	req.Header.Set("X-Apple-I-MD-RINFO", anisetteData.MDRINFO)
	req.Header.Set("X-Mme-Device-Id", anisetteData.DeviceID)
	req.Header.Set("X-MMe-Client-Info", anisetteData.ClientInfo)
	req.Header.Set("X-Apple-I-Client-Time", anisetteData.ClientTime)
	req.Header.Set("X-Apple-Locale", anisetteData.Locale)
	req.Header.Set("X-Apple-I-TimeZone", anisetteData.TimeZone)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("services request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read services response: %w", err)
	}

	if len(body) == 0 {
		return map[string]interface{}{}, nil
	}

	var respData map[string]interface{}
	if err := json.Unmarshal(body, &respData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal services response: %w", err)
	}

	if resultCode, found := parseNumericResultCode(respData["resultCode"]); found && resultCode != 0 {
		userString := stringValue(respData["userString"])
		if userString == "" {
			userString = stringValue(respData["resultString"])
		}
		log.Error().Int("result_code", resultCode).Str("user_string", userString).Str("path", path).Msg("Apple Developer services API error")
		return nil, fmt.Errorf("apple services api error (code %d): %s", resultCode, userString)
	}

	if errorsRaw, ok := respData["errors"].([]interface{}); ok && len(errorsRaw) > 0 {
		firstErr, _ := errorsRaw[0].(map[string]interface{})
		status := stringValue(firstErr["status"])
		detail := stringValue(firstErr["detail"])
		if detail == "" {
			detail = stringValue(firstErr["title"])
		}
		if detail == "" {
			detail = "unknown services api error"
		}
		return nil, fmt.Errorf("apple services api error%s: %s", formatStatus(status), detail)
	}

	return respData, nil
}

func parseNumericResultCode(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case uint64:
		return int(v), true
	case float64:
		return int(v), true
	case string:
		if v == "" {
			return 0, false
		}
		var parsed int
		_, err := fmt.Sscanf(v, "%d", &parsed)
		if err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func stringValue(value interface{}) string {
	if value == nil {
		return ""
	}
	if str, ok := value.(string); ok {
		return str
	}
	return fmt.Sprintf("%v", value)
}

func formatStatus(status string) string {
	if status == "" {
		return ""
	}
	return " (status " + status + ")"
}

func mapValueTypes(data map[string]interface{}) map[string]string {
	types := make(map[string]string, len(data))
	for key, value := range data {
		types[key] = fmt.Sprintf("%T", value)
	}
	return types
}

func decodeCertificateContent(attributes map[string]interface{}) ([]byte, error) {
	switch value := attributes["certContent"].(type) {
	case []byte:
		return value, nil
	case string:
		if value == "" {
			return nil, nil
		}
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err == nil {
			return decoded, nil
		}
		return []byte(value), nil
	case nil:
		encoded, ok := attributes["certificateContent"].(string)
		if !ok || encoded == "" {
			return nil, nil
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, err
		}
		return decoded, nil
	default:
		return nil, fmt.Errorf("unsupported certificate content type: %T", value)
	}
}

func normalizeCertificateData(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty certificate data")
	}

	if block, _ := pem.Decode(data); block != nil {
		return block.Bytes, nil
	}

	trimmed := bytes.TrimSpace(data)
	if decoded, err := base64.StdEncoding.DecodeString(string(trimmed)); err == nil {
		if block, _ := pem.Decode(decoded); block != nil {
			return block.Bytes, nil
		}
		return decoded, nil
	}

	return data, nil
}

func marshalPlist(data map[string]interface{}) ([]byte, error) {
	var buf bytes.Buffer
	encoder := plist.NewEncoder(&buf)
	encoder.Indent("\t")
	if err := encoder.Encode(data); err != nil {
		return nil, fmt.Errorf("plist encode error: %w", err)
	}
	return buf.Bytes(), nil
}

func unmarshalPlist(data []byte) (map[string]interface{}, error) {
	var result map[string]interface{}
	decoder := plist.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("plist decode error: %w", err)
	}
	return result, nil
}

func generateCSRAndKey(commonName string) ([]byte, []byte, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to generate key: %w", err)
	}

	tpl := &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: commonName},
		SignatureAlgorithm: x509.SHA256WithRSA,
	}

	csrDER, err := x509.CreateCertificateRequest(rand.Reader, tpl, key)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create csr: %w", err)
	}

	csrPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	return csrPEM, keyPEM, nil
}
