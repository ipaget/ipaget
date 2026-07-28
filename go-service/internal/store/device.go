package store

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"time"
)

// DeviceMetadata represents device identification metadata
type DeviceMetadata struct {
	UDID       string    `json:"udid"`         // Device UUID
	IMD        string    `json:"imd"`          // X-Apple-I-MD header (base64 encoded OTP)
	IMDM       string    `json:"imdm"`         // X-Apple-I-MD-M header (base64 encoded machine ID)
	CID        string    `json:"cid"`          // Client ID (unique per device)
	Email      string    `json:"email"`        // Account email this device is associated with
	CreatedAt  time.Time `json:"created_at"`   // When this device was first created
	LastUsedAt time.Time `json:"last_used_at"` // When this device was last used
	UseCount   int       `json:"use_count"`    // Number of times this device has been used
}

// GenerateDeviceMetadata generates device metadata for GSA authentication
// It tries to fetch real Anisette data from a server first, then falls back to fixed values
func GenerateDeviceMetadata(macAddress string, anisetteServerURL string) (*DeviceMetadata, error) {
	// Generate UDID from MAC address - unique per device but stable
	cleanMac := strings.ReplaceAll(strings.ToLower(macAddress), ":", "")
	hash := sha256.Sum256([]byte(cleanMac))
	udid := fmt.Sprintf("%x", hash[:20])

	// Generate Client ID - unique per device but stable (UUID format)
	cidHash := sha256.Sum256([]byte(cleanMac + "-cid-salt"))
	cid := fmt.Sprintf("%02X%02X%02X%02X-%02X%02X-%02X%02X-%02X%02X-%02X%02X%02X%02X%02X%02X",
		cidHash[0], cidHash[1], cidHash[2], cidHash[3],
		cidHash[4], cidHash[5],
		cidHash[6], cidHash[7],
		cidHash[8], cidHash[9],
		cidHash[10], cidHash[11], cidHash[12], cidHash[13], cidHash[14], cidHash[15],
	)

	var imd, imdm string

	// Try to fetch from Anisette server if URL is provided
	if anisetteServerURL != "" {
		anisetteData, err := FetchAnisetteData(anisetteServerURL)
		if err == nil && anisetteData != nil {
			imd = anisetteData.MD
			imdm = anisetteData.MDM
			// Use device ID from anisette if available
			if anisetteData.DeviceID != "" {
				udid = strings.ToLower(strings.ReplaceAll(anisetteData.DeviceID, "-", ""))
			}
		}
		// If failed, fall through to use fixed values
	}

	// Use fixed values from reference implementation as fallback
	// These are real Anisette data extracted from a provisioned device
	if imd == "" {
		imd = "AAAABQAAABBk4XZ4uF6VeFHpLDNXyex1AAAAAw=="
	}
	if imdm == "" {
		imdm = "Kjy3O6fJ6w92DvLSY8nhmimHbf4/Dfs2CMGSF+jObcgQOy/Gbl6NMAFDkSTBSlI2F/eF/JTbkG5zGAtL"
	}

	return &DeviceMetadata{
		UDID: udid,
		IMD:  imd,
		IMDM: imdm,
		CID:  cid,
	}, nil
}
