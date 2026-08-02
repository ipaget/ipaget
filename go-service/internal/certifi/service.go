package certifi

import (
	"archive/zip"
	"bytes"
	"crypto"
	crypto_rand "crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/sign"
	"ipaget-service/internal/store"

	"github.com/google/uuid"
	"software.sslmate.com/src/go-pkcs12"
)

type Service struct {
	mu            sync.RWMutex
	certificates  map[string]*Certificate
	storePath     string
	certFilesPath string
}

func normalizeAppleID(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// NewService creates a new certificate service
func NewService(dataPath string) (*Service, error) {
	storePath := filepath.Join(dataPath, "certificates", "store.json")
	certFilesPath := filepath.Join(dataPath, "certificates", "files")

	// Ensure directories exist
	if err := os.MkdirAll(filepath.Dir(storePath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create store directory: %w", err)
	}
	if err := os.MkdirAll(certFilesPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create cert files directory: %w", err)
	}

	s := &Service{
		certificates:  make(map[string]*Certificate),
		storePath:     storePath,
		certFilesPath: certFilesPath,
	}

	// Load existing certificates
	if err := s.load(); err != nil {
		logger.Warn().Err(err).Msg("Failed to load certificates, starting fresh")
	}

	return s, nil
}

// ImportP12 imports a P12 certificate with provisioning profile
func (s *Service) ImportP12(req ImportP12Request) (*Certificate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var p12Data, provisionData []byte
	var err error

	// Handle ZIP file if provided
	if req.ZipData != "" {
		zipData, err := base64.StdEncoding.DecodeString(req.ZipData)
		if err != nil {
			return nil, fmt.Errorf("failed to decode ZIP data: %w", err)
		}

		p12Data, provisionData, err = extractFilesFromZip(zipData)
		if err != nil {
			return nil, err
		}
	} else {
		// Decode separate P12 and provision files
		p12Data, err = base64.StdEncoding.DecodeString(req.P12Data)
		if err != nil {
			return nil, fmt.Errorf("failed to decode P12 data: %w", err)
		}

		provisionData, err = base64.StdEncoding.DecodeString(req.ProvisionData)
		if err != nil {
			return nil, fmt.Errorf("failed to decode provision data: %w", err)
		}
	}

	// Validate P12 and extract certificate data
	_, certData, _, err := sign.LoadP12CertificateFromData(p12Data, req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to validate P12 certificate: %w", err)
	}

	// Parse certificate to extract info
	x509Cert, err := x509.ParseCertificate(certData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	// Create temp files to parse provisioning profile
	tmpP12 := filepath.Join(os.TempDir(), "temp.p12")
	tmpProvision := filepath.Join(os.TempDir(), "temp.mobileprovision")
	defer os.Remove(tmpP12)
	defer os.Remove(tmpProvision)

	if err := os.WriteFile(tmpP12, p12Data, 0644); err != nil {
		return nil, fmt.Errorf("failed to write temp P12: %w", err)
	}
	if err := os.WriteFile(tmpProvision, provisionData, 0644); err != nil {
		return nil, fmt.Errorf("failed to write temp provision: %w", err)
	}

	// Parse provisioning profile
	profile, err := sign.ParseProvisioningProfile(tmpProvision)
	if err != nil {
		return nil, fmt.Errorf("failed to parse provisioning profile: %w", err)
	}

	// Generate unique ID
	certID := uuid.New().String()

	// Save certificate files
	certDir := filepath.Join(s.certFilesPath, certID)
	if err := os.MkdirAll(certDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create cert directory: %w", err)
	}

	p12Path := filepath.Join(certDir, "cert.p12")
	provisionPath := filepath.Join(certDir, "provision.mobileprovision")

	if err := os.WriteFile(p12Path, p12Data, 0644); err != nil {
		os.RemoveAll(certDir)
		return nil, fmt.Errorf("failed to save P12 file: %w", err)
	}
	if err := os.WriteFile(provisionPath, provisionData, 0644); err != nil {
		os.RemoveAll(certDir)
		return nil, fmt.Errorf("failed to save provision file: %w", err)
	}

	// Calculate days until expiry
	daysUntilExpiry := int(time.Until(profile.Expires).Hours() / 24)
	isExpired := time.Now().After(profile.Expires)

	// If setting as default, unset other defaults
	if req.IsDefault {
		for _, c := range s.certificates {
			c.IsDefault = false
		}
	}

	// Create certificate record
	certificate := &Certificate{
		ID:              certID,
		Name:            req.Name,
		Type:            "p12",
		Password:        req.Password,
		TeamID:          profile.TeamID,
		BundleID:        profile.AppID,
		CreatedAt:       time.Now(),
		ExpiresAt:       profile.Expires,
		IsDefault:       req.IsDefault,
		IsExpired:       isExpired,
		DaysUntilExpiry: daysUntilExpiry,
		CommonName:      x509Cert.Subject.CommonName,
		RawData: map[string]interface{}{
			"profile_name": profile.Name,
			"created":      profile.Created,
		},
	}

	s.certificates[certID] = certificate

	// Save to disk
	if err := s.save(); err != nil {
		logger.Error().Err(err).Msg("Failed to save certificates")
	}

	logger.Info().Str("id", certID).Str("name", req.Name).Msg("P12 certificate imported")

	return certificate, nil
}

// ImportFreeSign imports a free signing certificate (Apple ID based)
func (s *Service) ImportFreeSign(req ImportFreeSignRequest) (*Certificate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req.AppleID = normalizeAppleID(req.AppleID)
	if req.AppleID == "" {
		return nil, fmt.Errorf("apple_id is required")
	}
	// Either password (for new login) or DSID/AuthToken (for existing session) must be provided
	hasPassword := req.Password != ""
	hasSession := req.DSID != "" && req.AuthToken != ""

	if !hasPassword && !hasSession {
		return nil, fmt.Errorf("either password or existing session credentials (DSID/AuthToken) required")
	}

	// CRITICAL: When using existing session, AnisetteData must be provided
	// The Anisette data must match what was used during GSA authentication
	if hasSession && req.AnisetteData == nil {
		return nil, fmt.Errorf("AnisetteData is required when using existing session credentials - it must match the data used during GSA authentication")
	}

	log := logger.Logger

	client := NewDeveloperPortalClient()
	if client == nil {
		return nil, fmt.Errorf("developer portal client unavailable")
	}

	dsidPreview := req.DSID
	if len(req.DSID) > 20 {
		dsidPreview = req.DSID[:20] + "..."
	}
	tokenPreview := req.AuthToken
	if len(req.AuthToken) > 30 {
		tokenPreview = req.AuthToken[:30] + "..."
	}

	log.Debug().
		Str("apple_id", req.AppleID).
		Str("dsid_preview", dsidPreview).
		Str("token_preview", tokenPreview).
		Str("anisette_url", req.AnisetteURL).
		Bool("has_anisette_data", req.AnisetteData != nil).
		Msg("Creating Developer Portal session")

	// Create session from existing GSA credentials
	sess := client.CreateSession(req.DSID, req.AuthToken, req.AnisetteURL, req.AnisetteData)

	log.Debug().
		Str("apple_id", req.AppleID).
		Str("session_dsid", sess.DSID).
		Str("session_token_preview", func() string {
			if len(sess.AuthToken) > 30 {
				return sess.AuthToken[:30] + "..."
			}
			return sess.AuthToken
		}()).
		Msg("Developer Portal session created")

	team, err := client.SelectPersonalTeam(sess)
	if err != nil {
		return nil, fmt.Errorf("failed to select team: %w", err)
	}

	csrPEM, privKeyPEM, err := generateCSRAndKey("iOS Development")
	if err != nil {
		return nil, fmt.Errorf("failed to generate csr: %w", err)
	}

	certDER, expiresAt, commonName, err := client.CreateDevelopmentCertificate(sess, team, csrPEM)
	if err != nil {
		if strings.Contains(err.Error(), "code 7460") {
			logger.Info().Str("apple_id", req.AppleID).Str("team_id", team.TeamID).Msg("Development certificate already exists; revoking existing certificates and retrying")

			existingCerts, listErr := client.ListDevelopmentCertificates(sess, team)
			if listErr != nil {
				return nil, fmt.Errorf("failed to create development certificate: %w (additionally failed to list existing certificates: %v)", err, listErr)
			}

			if len(existingCerts) == 0 {
				return nil, fmt.Errorf("failed to create development certificate: %w", err)
			}

			for _, existingCert := range existingCerts {
				if revokeErr := client.RevokeDevelopmentCertificate(sess, team, existingCert.ID); revokeErr != nil {
					return nil, fmt.Errorf("failed to create development certificate: %w (additionally failed to revoke certificate %s: %v)", err, existingCert.ID, revokeErr)
				}
			}

			certDER, expiresAt, commonName, err = client.CreateDevelopmentCertificate(sess, team, csrPEM)
		}
		if err != nil {
			return nil, fmt.Errorf("failed to create development certificate: %w", err)
		}
	}

	x509Cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return nil, fmt.Errorf("failed to parse development certificate: %w", err)
	}

	// Align with iloader's account/certificate flow: obtain the development
	// certificate first, and defer app-specific App ID/profile generation until
	// a concrete bundle identifier is known.
	bundleID := ""
	profileName := ""

	certID := uuid.New().String()
	certDir := filepath.Join(s.certFilesPath, certID)
	if err := os.MkdirAll(certDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create cert directory: %w", err)
	}

	keyPath := filepath.Join(certDir, "key.pem")
	crtPath := filepath.Join(certDir, "cert.cer")

	if err := os.WriteFile(keyPath, privKeyPEM, 0600); err != nil {
		os.RemoveAll(certDir)
		return nil, fmt.Errorf("failed to save key: %w", err)
	}
	if err := os.WriteFile(crtPath, certDER, 0644); err != nil {
		os.RemoveAll(certDir)
		return nil, fmt.Errorf("failed to save certificate: %w", err)
	}

	daysUntilExpiry := int(time.Until(expiresAt).Hours() / 24)
	isExpired := time.Now().After(expiresAt)

	if req.IsDefault {
		for _, c := range s.certificates {
			c.IsDefault = false
		}
	}

	for _, existingCert := range s.certificates {
		if existingCert.Type != "free_sign" {
			continue
		}
		rawAppleID, _ := existingCert.RawData["apple_id"].(string)
		if normalizeAppleID(rawAppleID) != req.AppleID {
			continue
		}

		existingCert.IsExpired = time.Now().After(existingCert.ExpiresAt)
		existingCert.DaysUntilExpiry = int(time.Until(existingCert.ExpiresAt).Hours() / 24)
		if !existingCert.IsExpired && existingCert.DaysUntilExpiry > 1 {
			if req.IsDefault {
				for _, c := range s.certificates {
					c.IsDefault = false
				}
				existingCert.IsDefault = true
				if err := s.save(); err != nil {
					logger.Warn().Err(err).Str("certificate_id", existingCert.ID).Msg("Failed to persist reused free-sign certificate")
				}
			}
			return existingCert, nil
		}
	}

	certificate := &Certificate{
		ID:              certID,
		Name:            req.Name,
		Type:            "free_sign",
		Password:        "",
		TeamID:          team.TeamID,
		BundleID:        bundleID,
		CreatedAt:       time.Now(),
		ExpiresAt:       expiresAt,
		IsDefault:       req.IsDefault,
		IsExpired:       isExpired,
		DaysUntilExpiry: daysUntilExpiry,
		CommonName:      commonName,
		RawData: map[string]interface{}{
			"apple_id":           req.AppleID,
			"profile_name":       profileName,
			"certificate_only":   true,
			"certificate_serial": x509Cert.SerialNumber.String(),
		},
	}

	for existingID, existingCert := range s.certificates {
		if existingID == certID || existingCert.Type != "free_sign" {
			continue
		}
		rawAppleID, _ := existingCert.RawData["apple_id"].(string)
		if normalizeAppleID(rawAppleID) != req.AppleID {
			continue
		}

		delete(s.certificates, existingID)
		existingDir := filepath.Join(s.certFilesPath, existingID)
		if removeErr := os.RemoveAll(existingDir); removeErr != nil {
			logger.Warn().Err(removeErr).Str("certificate_id", existingID).Msg("Failed to remove superseded free-sign certificate files")
		}
	}

	s.certificates[certID] = certificate
	if err := s.save(); err != nil {
		log.Warn().Err(err).Msg("Failed to save certificates")
	}

	log.Info().Str("id", certID).Str("name", req.Name).Msg("Free-sign certificate imported")
	return certificate, nil
}

// ListCertificates returns all certificates
func (s *Service) ListCertificates() []*Certificate {
	s.mu.RLock()
	defer s.mu.RUnlock()

	certs := make([]*Certificate, 0, len(s.certificates))
	for _, cert := range s.certificates {
		// Update derived fields
		cert.IsExpired = time.Now().After(cert.ExpiresAt)
		cert.DaysUntilExpiry = int(time.Until(cert.ExpiresAt).Hours() / 24)
		certs = append(certs, cert)
	}

	return certs
}

// GetCertificate returns a certificate by ID
func (s *Service) GetCertificate(id string) (*Certificate, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cert, exists := s.certificates[id]
	if !exists {
		return nil, fmt.Errorf("certificate not found: %s", id)
	}

	// Update derived fields
	cert.IsExpired = time.Now().After(cert.ExpiresAt)
	cert.DaysUntilExpiry = int(time.Until(cert.ExpiresAt).Hours() / 24)

	return cert, nil
}

// GetFreeSignCertForAppleID returns the free signing certificate for a specific Apple ID
func (s *Service) GetFreeSignCertForAppleID(appleID string) (*Certificate, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	appleID = normalizeAppleID(appleID)

	var selected *Certificate
	for _, cert := range s.certificates {
		if cert.Type == "free_sign" {
			// Check if the RawData contains the apple_id field
			if rawAppleID, ok := cert.RawData["apple_id"].(string); ok && normalizeAppleID(rawAppleID) == appleID {
				cert.IsExpired = time.Now().After(cert.ExpiresAt)
				cert.DaysUntilExpiry = int(time.Until(cert.ExpiresAt).Hours() / 24)
				if selected == nil || cert.ExpiresAt.After(selected.ExpiresAt) {
					selected = cert
				}
			}
		}
	}

	if selected != nil {
		return selected, nil
	}

	// No certificate found for this Apple ID
	return nil, nil
}

// GetCertificateFiles returns the file paths for a certificate
func (s *Service) GetCertificateFiles(id string) (*CertificateFiles, error) {
	cert, err := s.GetCertificate(id)
	if err != nil {
		return nil, err
	}

	certDir := filepath.Join(s.certFilesPath, id)

	if cert.Type == "p12" {
		return &CertificateFiles{
			P12Path:       filepath.Join(certDir, "cert.p12"),
			ProvisionPath: filepath.Join(certDir, "provision.mobileprovision"),
		}, nil
	}

	if cert.Type == "free_sign" {
		// free_sign may be certificate-only until an app-specific provisioning
		// profile is generated later for a concrete bundle identifier.
		provisionPath := filepath.Join(certDir, "provision.mobileprovision")
		if _, err := os.Stat(provisionPath); err != nil {
			provisionPath = ""
		}
		return &CertificateFiles{
			P12Path:       "",
			ProvisionPath: provisionPath,
		}, nil
	}

	return nil, fmt.Errorf("unsupported certificate type: %s", cert.Type)
}

func (s *Service) ExportCertificate(id string) (*ExportedCertificateFile, error) {
	cert, err := s.GetCertificate(id)
	if err != nil {
		return nil, err
	}

	files, err := s.GetCertificateFiles(id)
	if err != nil {
		return nil, err
	}

	fileName := sanitizeFileName(cert.Name)
	if fileName == "" {
		fileName = cert.ID
	}

	if cert.Type == "p12" {
		if files.P12Path == "" {
			return nil, fmt.Errorf("certificate %s does not have a P12 file", cert.Name)
		}
		if files.ProvisionPath == "" {
			return nil, fmt.Errorf("certificate %s does not have a provisioning profile", cert.Name)
		}

		p12Data, err := os.ReadFile(files.P12Path)
		if err != nil {
			return nil, fmt.Errorf("failed to read P12 file: %w", err)
		}
		provisionData, err := os.ReadFile(files.ProvisionPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read provisioning profile: %w", err)
		}

		archiveData, err := buildCertificateArchive(fileName, p12Data, provisionData)
		if err != nil {
			return nil, fmt.Errorf("failed to build certificate archive: %w", err)
		}

		return &ExportedCertificateFile{
			FileName:    fileName + ".zip",
			ContentType: "application/zip",
			Data:        archiveData,
		}, nil
	}

	if cert.Type != "free_sign" {
		return nil, fmt.Errorf("certificate export not supported for type: %s", cert.Type)
	}

	certDir := filepath.Join(s.certFilesPath, cert.ID)
	privateKeyPEM, err := os.ReadFile(filepath.Join(certDir, "key.pem"))
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}
	certificateData, err := os.ReadFile(filepath.Join(certDir, "cert.cer"))
	if err != nil {
		return nil, fmt.Errorf("failed to read certificate: %w", err)
	}

	privateKey, err := parsePrivateKeyFromPEM(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	certificateData, err = normalizeCertificateBytes(certificateData)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize certificate: %w", err)
	}

	x509Cert, err := x509.ParseCertificate(certificateData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	password := cert.ID
	if serial, ok := cert.RawData["certificate_serial"].(string); ok && strings.TrimSpace(serial) != "" {
		password = strings.TrimSpace(serial)
	}

	p12Data, err := pkcs12.Encode(crypto_rand.Reader, privateKey, x509Cert, nil, password)
	if err != nil {
		return nil, fmt.Errorf("failed to generate P12 file: %w", err)
	}

	return &ExportedCertificateFile{
		FileName:    fileName + ".p12",
		ContentType: "application/x-pkcs12",
		Data:        p12Data,
	}, nil
}

func (s *Service) PrepareSigningAssets(id string, bundleID string, deviceName string, udid string, creds *store.GSACredentials) (*SigningAssets, error) {
	cert, err := s.GetCertificate(id)
	if err != nil {
		return nil, err
	}
	if cert.IsExpired {
		return nil, fmt.Errorf("certificate has expired: %s", cert.Name)
	}

	files, err := s.GetCertificateFiles(id)
	if err != nil {
		return nil, err
	}

	if cert.Type == "p12" {
		if files.P12Path == "" {
			return nil, fmt.Errorf("certificate %s does not have a P12 file", cert.Name)
		}
		if files.ProvisionPath == "" {
			return nil, fmt.Errorf("certificate %s does not have a provisioning profile", cert.Name)
		}

		p12Data, err := os.ReadFile(files.P12Path)
		if err != nil {
			return nil, fmt.Errorf("failed to read P12 file: %w", err)
		}
		provisionData, err := os.ReadFile(files.ProvisionPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read provisioning profile: %w", err)
		}

		return &SigningAssets{
			Certificate:   cert,
			P12Data:       p12Data,
			P12Password:   cert.Password,
			ProvisionData: provisionData,
		}, nil
	}

	if cert.Type != "free_sign" {
		return nil, fmt.Errorf("unsupported certificate type: %s", cert.Type)
	}
	bundleID = DeriveFreeSignBundleID(bundleID, cert.TeamID)
	if strings.TrimSpace(bundleID) == "" {
		return nil, fmt.Errorf("bundle ID is required for free signing")
	}
	if creds == nil {
		return nil, fmt.Errorf("GSA credentials are required for free signing")
	}

	certDir := filepath.Join(s.certFilesPath, cert.ID)
	privateKeyPEM, err := os.ReadFile(filepath.Join(certDir, "key.pem"))
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}
	certificateData, err := os.ReadFile(filepath.Join(certDir, "cert.cer"))
	if err != nil {
		return nil, fmt.Errorf("failed to read certificate: %w", err)
	}

	privateKey, err := parsePrivateKeyFromPEM(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}
	certificateData, err = normalizeCertificateBytes(certificateData)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize certificate: %w", err)
	}
	x509Cert, err := x509.ParseCertificate(certificateData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	password := cert.ID
	if serial, ok := cert.RawData["certificate_serial"].(string); ok && strings.TrimSpace(serial) != "" {
		password = strings.TrimSpace(serial)
	}

	p12Data, err := pkcs12.Encode(crypto_rand.Reader, privateKey, x509Cert, nil, password)
	if err != nil {
		return nil, fmt.Errorf("failed to build P12 data: %w", err)
	}

	client := NewDeveloperPortalClient()
	if client == nil {
		return nil, fmt.Errorf("developer portal client unavailable")
	}
	sess := client.CreateSession(creds.DSID, creds.AuthToken, creds.AnisetteURL, creds.AnisetteData)
	teamID := strings.TrimSpace(cert.TeamID)
	if teamID == "" {
		return nil, fmt.Errorf("certificate %s is missing team ID", cert.Name)
	}
	team := &Team{TeamID: teamID, TeamType: "free"}

	if strings.TrimSpace(deviceName) == "" {
		deviceName = "ipaget-" + udid
	}
	if err := client.RegisterDevice(sess, team, deviceName, udid); err != nil {
		return nil, err
	}
	if err := client.EnsureAppID(sess, team, bundleID); err != nil {
		return nil, err
	}
	provisionData, profileName, err := client.EnsureProvisioningProfile(sess, team, bundleID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	if current, exists := s.certificates[id]; exists {
		current.RawData["profile_name"] = profileName
		current.RawData["certificate_only"] = false
		if saveErr := s.save(); saveErr != nil {
			logger.Warn().Err(saveErr).Str("certificate_id", id).Msg("Failed to persist free-sign profile metadata")
		}
	}
	s.mu.Unlock()

	return &SigningAssets{
		Certificate:   cert,
		P12Data:       p12Data,
		P12Password:   password,
		ProvisionData: provisionData,
	}, nil
}

func DeriveFreeSignBundleID(bundleID string, teamID string) string {
	bundleID = strings.TrimSpace(bundleID)
	teamID = strings.TrimSpace(teamID)
	if bundleID == "" || teamID == "" {
		return bundleID
	}
	suffix := "." + teamID
	if strings.HasSuffix(bundleID, suffix) {
		return bundleID
	}
	return bundleID + suffix
}

func parsePrivateKeyFromPEM(privateKeyPEM []byte) (crypto.PrivateKey, error) {
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, fmt.Errorf("invalid private key PEM")
	}

	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	return nil, fmt.Errorf("unsupported private key format")
}

func normalizeCertificateBytes(data []byte) ([]byte, error) {
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

func sanitizeFileName(name string) string {
	replacer := strings.NewReplacer(
		"<", "_",
		">", "_",
		":", "_",
		"\"", "_",
		"/", "_",
		"\\", "_",
		"|", "_",
		"?", "_",
		"*", "_",
	)
	return strings.TrimSpace(replacer.Replace(name))
}

func buildCertificateArchive(baseName string, p12Data []byte, provisionData []byte) ([]byte, error) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)

	entries := []struct {
		name string
		data []byte
	}{
		{name: baseName + ".p12", data: p12Data},
		{name: baseName + ".mobileprovision", data: provisionData},
	}

	for _, entry := range entries {
		writer, err := archive.Create(entry.name)
		if err != nil {
			archive.Close()
			return nil, err
		}
		if _, err := writer.Write(entry.data); err != nil {
			archive.Close()
			return nil, err
		}
	}

	if err := archive.Close(); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}

// DeleteCertificate deletes a certificate
func (s *Service) DeleteCertificate(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cert, exists := s.certificates[id]
	if !exists {
		return fmt.Errorf("certificate not found: %s", id)
	}

	// Delete certificate files
	certDir := filepath.Join(s.certFilesPath, id)
	if err := os.RemoveAll(certDir); err != nil {
		logger.Error().Err(err).Str("id", id).Msg("Failed to delete certificate files")
	}

	// Remove from map
	delete(s.certificates, id)

	// If this was the default cert, set another one as default if available
	if cert.IsDefault && len(s.certificates) > 0 {
		for _, c := range s.certificates {
			c.IsDefault = true
			break
		}
	}

	// Save to disk
	if err := s.save(); err != nil {
		logger.Error().Err(err).Msg("Failed to save certificates")
	}

	logger.Info().Str("id", id).Str("name", cert.Name).Msg("Certificate deleted")

	return nil
}

// SetDefaultCertificate sets a certificate as the default
func (s *Service) SetDefaultCertificate(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cert, exists := s.certificates[id]
	if !exists {
		return fmt.Errorf("certificate not found: %s", id)
	}

	// Unset all other defaults
	for _, c := range s.certificates {
		c.IsDefault = false
	}

	// Set this one as default
	cert.IsDefault = true

	// Save to disk
	if err := s.save(); err != nil {
		logger.Error().Err(err).Msg("Failed to save certificates")
	}

	logger.Info().Str("id", id).Str("name", cert.Name).Msg("Certificate set as default")

	return nil
}

// GetDefaultCertificate returns the default certificate
func (s *Service) GetDefaultCertificate() (*Certificate, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, cert := range s.certificates {
		if cert.IsDefault {
			// Update derived fields
			cert.IsExpired = time.Now().After(cert.ExpiresAt)
			cert.DaysUntilExpiry = int(time.Until(cert.ExpiresAt).Hours() / 24)
			return cert, nil
		}
	}

	return nil, fmt.Errorf("no default certificate set")
}

// save persists certificates to disk
func (s *Service) save() error {
	data, err := json.MarshalIndent(s.certificates, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal certificates: %w", err)
	}

	if err := os.WriteFile(s.storePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write certificates: %w", err)
	}

	return nil
}

// load loads certificates from disk
func (s *Service) load() error {
	data, err := os.ReadFile(s.storePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No certificates yet
		}
		return fmt.Errorf("failed to read certificates: %w", err)
	}

	if err := json.Unmarshal(data, &s.certificates); err != nil {
		return fmt.Errorf("failed to unmarshal certificates: %w", err)
	}

	logger.Info().Int("count", len(s.certificates)).Msg("Certificates loaded")

	return nil
}

// extractFilesFromZip extracts P12 and mobileprovision files from a ZIP archive
func extractFilesFromZip(zipData []byte) (p12Data, provisionData []byte, err error) {
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read ZIP archive: %w", err)
	}

	var foundP12, foundProvision bool

	for _, file := range reader.File {
		// Skip directories and hidden files
		if file.FileInfo().IsDir() || strings.HasPrefix(filepath.Base(file.Name), ".") {
			continue
		}

		fileName := strings.ToLower(file.Name)

		// Check for P12/PFX file
		if !foundP12 && (strings.HasSuffix(fileName, ".p12") || strings.HasSuffix(fileName, ".pfx")) {
			rc, err := file.Open()
			if err != nil {
				return nil, nil, fmt.Errorf("failed to open %s in ZIP: %w", file.Name, err)
			}
			p12Data, err = io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return nil, nil, fmt.Errorf("failed to read %s from ZIP: %w", file.Name, err)
			}
			foundP12 = true
		}

		// Check for mobileprovision file
		if !foundProvision && strings.HasSuffix(fileName, ".mobileprovision") {
			rc, err := file.Open()
			if err != nil {
				return nil, nil, fmt.Errorf("failed to open %s in ZIP: %w", file.Name, err)
			}
			provisionData, err = io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return nil, nil, fmt.Errorf("failed to read %s from ZIP: %w", file.Name, err)
			}
			foundProvision = true
		}

		// If we found both, we're done
		if foundP12 && foundProvision {
			break
		}
	}

	// Check what's missing and return appropriate error
	if !foundP12 && !foundProvision {
		return nil, nil, fmt.Errorf("ZIP archive is missing both .p12/.pfx and .mobileprovision files")
	}
	if !foundP12 {
		return nil, nil, fmt.Errorf("ZIP archive is missing .p12 or .pfx file")
	}
	if !foundProvision {
		return nil, nil, fmt.Errorf("ZIP archive is missing .mobileprovision file")
	}

	return p12Data, provisionData, nil
}
