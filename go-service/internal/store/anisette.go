package store

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"ipaget-service/internal/logger"
)

// AnisetteData represents the anisette data returned from the server
type AnisetteData struct {
	ClientTime string `json:"X-Apple-I-Client-Time"`
	MD         string `json:"X-Apple-I-MD"`
	MDM        string `json:"X-Apple-I-MD-M"`
	MDRINFO    string `json:"X-Apple-I-MD-RINFO"`
	MDLU       string `json:"X-Apple-I-MD-LU"`
	SRLNO      string `json:"X-Apple-I-SRL-NO"`
	ClientInfo string `json:"X-MMe-Client-Info"`
	TimeZone   string `json:"X-Apple-I-TimeZone"`
	Locale     string `json:"X-Apple-Locale"`
	DeviceID   string `json:"X-Mme-Device-Id"`
}

// FetchAnisetteData fetches anisette data from the specified server
func FetchAnisetteData(serverURL string) (*AnisetteData, error) {
	log := logger.Logger

	log.Debug().Str("server", serverURL).Msg("Fetching Anisette data from server")

	// Create HTTP client with TLS config and timeout
	tr := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Timeout:   10 * time.Second,
		Transport: tr,
	}
	req, err := http.NewRequest("GET", serverURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build anisette request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to anisette server: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anisette server returned status %d", resp.StatusCode)
	}

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read anisette response: %w", err)
	}

	// Parse JSON response
	var data AnisetteData
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("failed to parse anisette data: %w", err)
	}

	if err := validateAnisetteClientTime(data.ClientTime); err != nil {
		return nil, fmt.Errorf("invalid anisette client time: %w", err)
	}

	log.Debug().Str("device_id", data.DeviceID).Str("client_time", data.ClientTime).Msg("Successfully fetched Anisette data")

	return &data, nil
}

func validateAnisetteClientTime(clientTime string) error {
	ct := strings.TrimSpace(clientTime)
	if ct == "" {
		return fmt.Errorf("client time is empty")
	}

	// Anisette servers sometimes return ISO8601 with 'Z'. Accept both RFC3339 and the specific UTC format.
	parsed, err := time.Parse(time.RFC3339, ct)
	if err != nil {
		parsed, err = time.Parse("2006-01-02T15:04:05Z", ct)
		if err != nil {
			return fmt.Errorf("cannot parse client time %q: %w", ct, err)
		}
	}

	// Reject stale times (e.g., weeks old) which will cause DevPortal session expired.
	// Allow some clock skew.
	now := time.Now().UTC()
	if parsed.Before(now.Add(-6 * time.Hour)) {
		return fmt.Errorf("client time is too old: %s (now=%s)", parsed.Format(time.RFC3339), now.Format(time.RFC3339))
	}
	if parsed.After(now.Add(6 * time.Hour)) {
		return fmt.Errorf("client time is too far in the future: %s (now=%s)", parsed.Format(time.RFC3339), now.Format(time.RFC3339))
	}

	return nil
}

// GetDefaultAnisetteServers returns a list of default anisette servers to try
func GetDefaultAnisetteServers() []string {
	return []string{
		"https://ani.zetx.tech",
		"https://ani.sidestore.app",
	}
}
