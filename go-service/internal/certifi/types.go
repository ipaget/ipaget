package certifi

import (
	"time"

	"ipaget-service/internal/store"
)

// Certificate represents a stored signing certificate
type Certificate struct {
	ID              string                 `json:"id"`                 // UUID
	Name            string                 `json:"name"`               // User-provided nickname
	Type            string                 `json:"type"`               // "p12" or "free_sign"
	Password        string                 `json:"-"`                  // P12 password (not exported to JSON)
	TeamID          string                 `json:"team_id"`            // Team ID from cert/profile
	BundleID        string                 `json:"bundle_id"`          // Bundle ID pattern from profile
	CreatedAt       time.Time              `json:"created_at"`         // When cert was imported
	ExpiresAt       time.Time              `json:"expires_at"`         // Certificate expiration
	IsDefault       bool                   `json:"is_default"`         // Whether this is the default cert
	IsExpired       bool                   `json:"is_expired"`         // Derived field
	DaysUntilExpiry int                    `json:"days_until_expiry"`  // Derived field
	CommonName      string                 `json:"common_name"`        // Certificate subject CN
	RawData         map[string]interface{} `json:"raw_data,omitempty"` // Additional metadata
}

// CertificateFiles represents the files for a certificate
type CertificateFiles struct {
	P12Path       string // Path to .p12 file
	ProvisionPath string // Path to .mobileprovision file
}

type ExportedCertificateFile struct {
	FileName    string
	ContentType string
	Data        []byte
}

type SigningAssets struct {
	Certificate   *Certificate
	P12Data       []byte
	P12Password   string
	ProvisionData []byte
}

// ImportP12Request represents a request to import a P12 certificate
type ImportP12Request struct {
	Name          string `json:"name"`                     // User-provided nickname
	P12Data       string `json:"p12_data,omitempty"`       // Base64 encoded P12 file
	ProvisionData string `json:"provision_data,omitempty"` // Base64 encoded mobileprovision file
	ZipData       string `json:"zip_data,omitempty"`       // Base64 encoded ZIP file (alternative to separate files)
	Password      string `json:"password"`                 // P12 password
	IsDefault     bool   `json:"is_default"`               // Set as default cert
}

// ImportFreeSignRequest represents a request to import a free signing certificate (Apple ID)
type ImportFreeSignRequest struct {
	Name         string              `json:"name"`       // User-provided nickname
	AppleID      string              `json:"apple_id"`   // Apple ID email
	Password     string              `json:"password"`   // Apple ID password
	DSID         string              `json:"-"`          // GSA Directory Services ID (not from API)
	AuthToken    string              `json:"-"`          // GSA auth token for xcode.auth (not from API)
	AnisetteURL  string              `json:"-"`          // Anisette server URL (not from API)
	AnisetteData *store.AnisetteData `json:"-"`          // Cached Anisette data matching the AuthToken
	IsDefault    bool                `json:"is_default"` // Set as default cert
}
