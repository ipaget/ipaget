# iOS Signing Package

Pure Go implementation of iOS app signing. Rewrites zsign's logic without system dependencies.

## Installation

```bash
go get ipaget-service/internal/sign
```

## Quick Start

### Adhoc Signing (No Certificate)

```go
import "ipaget-service/internal/sign"

// Simple adhoc signing for sideloading
err := sign.SignIPAAdhoc("input.ipa", "output.ipa")
if err != nil {
    log.Fatal(err)
}
```

### Certificate Signing

```go
// Load provisioning profile
profile, err := sign.ParseProvisioningProfile("dev.mobileprovision")
if err != nil {
    log.Fatal(err)
}

// Sign with P12 certificate
err = sign.SignIPAWithP12(
    "input.ipa",
    "output.ipa",
    "cert.p12",
    "password",
    profile,
)
```

### Sign with P12 Only (Uses Embedded Profile)

```go
// If IPA already has embedded.mobileprovision
err := sign.SignIPAWithP12("input.ipa", "output.ipa", "cert.p12", "password", nil)
```

## Entitlements

### Extract from IPA

```go
ents, err := sign.ExtractEntitlementsFromIPA("app.ipa")
if err != nil {
    log.Fatal(err)
}

// Access entitlements
appID := ents["application-identifier"].(string)
teamID := ents["com.apple.developer.team-identifier"].(string)
hasLocation := ents["com.apple.developer.location"] != nil
```

### Extract from Mobileprovision

```go
ents, err := sign.ExtractEntitlementsFromMobileprovision("profile.mobileprovision")
if err != nil {
    log.Fatal(err)
}
```

### Save Entitlements

```go
err := sign.SaveEntitlementsToFile(ents, "entitlements.plist")
```

### Modify Entitlements

```go
profile, _ := sign.ParseProvisioningProfile("dev.mobileprovision")
ents := profile.GetEntitlements()

// Add custom entitlements
ents["com.apple.developer.icloud-container-identifiers"] = []interface{}{
    "iCloud.com.example.app",
}

// Remove development entitlements
profile.RemoveGetTaskAllow()

// Use modified entitlements
options := sign.SignerOptions{
    InputPath:    "input.ipa",
    OutputPath:   "output.ipa",
    P12File:      "cert.p12",
    P12Password:  "password",
    Entitlements: ents,
}
err := sign.SignIPA(options)
```

## Provisioning Profiles

### Parse Profile

```go
profile, err := sign.ParseProvisioningProfile("dev.mobileprovision")
if err != nil {
    log.Fatal(err)
}

fmt.Printf("Name: %s\n", profile.Name)
fmt.Printf("Team ID: %s\n", profile.TeamID)
fmt.Printf("App ID: %s\n", profile.AppID)
fmt.Printf("Created: %s\n", profile.Created)
fmt.Printf("Expires: %s\n", profile.Expires)

// Check if expired
if time.Now().After(profile.Expires) {
    log.Fatal("Profile expired")
}
```

### Update Profile for Different Bundle ID

```go
profile, _ := sign.ParseProvisioningProfile("wildcard.mobileprovision")
profile.Update("com.example.newapp")

options := sign.SignerOptions{
    InputPath:     "input.ipa",
    OutputPath:    "output.ipa",
    P12File:       "cert.p12",
    P12Password:   "password",
    Entitlements:  profile.GetEntitlements(),
    NewBundleID:   "com.example.newapp",
}
err := sign.SignIPA(options)
```

## Certificates

### Load P12 Certificate

```go
cert, certData, privateKey, err := sign.LoadP12Certificate("cert.p12", "password")
if err != nil {
    log.Fatal(err)
}

fmt.Printf("Certificate: %s\n", cert.CommonName)
fmt.Printf("Cert size: %d bytes\n", len(certData))
```

### Use Password from Environment

```go
password := os.Getenv("P12_PASSWORD")
if password == "" {
    log.Fatal("P12_PASSWORD not set")
}

err := sign.SignIPAWithP12("input.ipa", "output.ipa", "cert.p12", password, profile)
```

## Advanced Usage

### Custom Signing Options

```go
options := sign.SignerOptions{
    InputPath:         "input.ipa",
    OutputPath:        "output.ipa",
    P12File:           "cert.p12",
    P12Password:       "password",
    ProvisionFile:     "profile.mobileprovision",
    NewBundleID:       "com.example.app",
    Entitlements:      customEntitlements,
    PreserveMetadata:  true,
}

err := sign.SignIPA(options)
```

### Change Bundle ID

```go
options := sign.SignerOptions{
    InputPath:   "input.ipa",
    OutputPath:  "output.ipa",
    NewBundleID: "com.company.newapp",
}
err := sign.SignIPA(options)
```

### Sign with Custom Entitlements

```go
customEnts := map[string]interface{}{
    "application-identifier":                "TEAM123.com.example.app",
    "com.apple.developer.team-identifier":   "TEAM123",
    "get-task-allow":                        true,
    "keychain-access-groups": []interface{}{
        "TEAM123.*",
    },
}

options := sign.SignerOptions{
    InputPath:    "input.ipa",
    OutputPath:   "output.ipa",
    Entitlements: customEnts,
}
err := sign.SignIPA(options)
```

### Batch Signing

```go
files := []string{"app1.ipa", "app2.ipa", "app3.ipa"}

profile, _ := sign.ParseProvisioningProfile("dev.mobileprovision")

for i, file := range files {
    output := fmt.Sprintf("signed_%d.ipa", i)
    
    err := sign.SignIPAWithP12(file, output, "cert.p12", "password", profile)
    if err != nil {
        log.Printf("Failed %s: %v", file, err)
        continue
    }
    
    log.Printf("Signed: %s", output)
}
```

### Parallel Signing

```go
var wg sync.WaitGroup
files := []string{"app1.ipa", "app2.ipa", "app3.ipa"}

for i, file := range files {
    wg.Add(1)
    go func(input string, idx int) {
        defer wg.Done()
        output := fmt.Sprintf("signed_%d.ipa", idx)
        if err := sign.SignIPAAdhoc(input, output); err != nil {
            log.Printf("Error: %v", err)
        }
    }(file, i)
}

wg.Wait()
```

## CLI Tool

### Build

```bash
cd go-service/cmd/ipasign
go build -o ipasign        # Unix
go build -o ipasign.exe    # Windows
```

### Usage

```bash
# Adhoc signing
./ipasign -i input.ipa -o output.ipa

# Sign with P12
./ipasign -i input.ipa -o output.ipa -p cert.p12 -pw password

# Sign with P12 and profile
./ipasign -i input.ipa -o output.ipa -p cert.p12 -pw password -m dev.mobileprovision

# Change bundle ID
./ipasign -i input.ipa -o output.ipa -b com.example.newapp

# Extract entitlements
./ipasign -i input.ipa -e

# Show version
./ipasign -v

# Show help
./ipasign -h
```

## Error Handling

### Check Errors

```go
err := sign.SignIPAAdhoc("input.ipa", "output.ipa")
if err != nil {
    // Errors include context:
    // "failed to extract IPA: zip: not a valid zip file"
    // "failed to locate app folder: no .app found in Payload"
    // "failed to sign executable: data too small"
    log.Fatalf("Signing failed: %v", err)
}
```

### Validate Inputs

```go
// Check file exists
if _, err := os.Stat(ipaPath); os.IsNotExist(err) {
    return fmt.Errorf("IPA not found: %s", ipaPath)
}

// Check profile not expired
profile, _ := sign.ParseProvisioningProfile("dev.mobileprovision")
if time.Now().After(profile.Expires) {
    return fmt.Errorf("profile expired: %s", profile.Expires)
}
```

## Common Scenarios

### Sideload to iPhone (AltStore/Sideloadly)

```go
// Adhoc sign for personal device
err := sign.SignIPAAdhoc("MyApp.ipa", "MyApp_sideload.ipa")
// Upload MyApp_sideload.ipa to AltStore
```

### Enterprise Distribution

```go
options := sign.SignerOptions{
    InputPath:     "EnterpriseApp.ipa",
    OutputPath:    "EnterpriseApp_signed.ipa",
    P12File:       "enterprise.p12",
    P12Password:   os.Getenv("P12_PASSWORD"),
    ProvisionFile: "enterprise.mobileprovision",
}
err := sign.SignIPA(options)
```

### Re-sign App Store IPA

```go
// Extract entitlements first
ents, _ := sign.ExtractEntitlementsFromIPA("AppStore.ipa")

// Sign with development certificate
profile, _ := sign.ParseProvisioningProfile("dev.mobileprovision")
err := sign.SignIPAWithP12("AppStore.ipa", "dev_signed.ipa", "dev.p12", "password", profile)
```

## API Reference

### Signing Functions

```go
// Adhoc signing (no certificate)
SignIPAAdhoc(inputIPA, outputIPA string) error

// Sign with P12 certificate
SignIPAWithP12(inputIPA, outputIPA, p12Path, p12Password string, profile *ProvisioningProfile) error

// Sign with custom options
SignIPA(options SignerOptions) error
```

### Entitlements Functions

```go
// Extract from IPA file
ExtractEntitlementsFromIPA(ipaPath string) (map[string]interface{}, error)

// Extract from mobileprovision
ExtractEntitlementsFromMobileprovision(path string) (map[string]interface{}, error)

// Save to plist file
SaveEntitlementsToFile(ents map[string]interface{}, outputPath string) error
```

### Profile Functions

```go
// Parse mobileprovision file
ParseProvisioningProfile(filename string) (*ProvisioningProfile, error)

// Profile methods
(p *ProvisioningProfile) GetEntitlements() map[string]interface{}
(p *ProvisioningProfile) RemoveGetTaskAllow()
(p *ProvisioningProfile) Update(trueAppID string)
```

### Certificate Functions

```go
// Load P12 certificate
LoadP12Certificate(p12Path, password string) (*Certificate, []byte, crypto.PrivateKey, error)
```

### Types

```go
type SignerOptions struct {
    InputPath         string
    OutputPath        string
    P12File           string
    P12Password       string
    ProvisionFile     string
    NewBundleID       string
    Entitlements      map[string]interface{}
    PreserveMetadata  bool
}

type ProvisioningProfile struct {
    Filename     string
    Name         string
    Created      time.Time
    Expires      time.Time
    AppID        string
    TeamID       string
    Entitlements map[string]interface{}
    Path         string
}

type Certificate struct {
    Certificate []byte
    PrivateKey  []byte
    CommonName  string
}
```

## Implementation Details

Complete iOS signing workflow:

- **Mach-O Parsing**: Parse FAT and single-arch binaries
- **Signature Removal**: Remove existing LC_CODE_SIGNATURE
- **Requirements**: Build requirements blob (0xfade0c01)
- **Entitlements**: Encode as XML and DER format
- **Code Directory**: Generate SHA-1 and SHA-256 directories with page hashing (4KB)
- **CMS Signature**: Create PKCS#7 signature (non-adhoc only)
- **SuperBlob**: Assemble all blobs into superblob (0xfade0cc0)
- **Recursive Signing**: Sign frameworks, dylibs, appex before main app

Based on zsign algorithm, completely rewritten in Go.

## Platform Support

Works on all platforms without system commands:

- **Windows**: Full support, no WSL needed
- **macOS**: Full support, no `codesign` command needed
- **Linux**: Full support

No dependencies on `codesign`, `security`, or other system tools.

## Dependencies

```go
require (
    howett.net/plist v1.0.0                    // Plist parsing
    go.mozilla.org/pkcs7 v0.0.0-...            // PKCS#7 parsing
    software.sslmate.com/src/go-pkcs12 v0.2.0  // P12 certificates
)
```

All pure Go, no CGO required.

## Limitations

- CodeResources signing not implemented (most apps work without it)
- No timestamp server support
- No certificate trust chain validation
- Large files loaded entirely into memory

## Testing

```bash
cd go-service/internal/sign
go test -v
```

## Troubleshooting

**"file too small to be a Mach-O binary"**
- IPA is corrupted, verify with `unzip -t input.ipa`

**"failed to decode P12 file"**
- Wrong password, test with `openssl pkcs12 -in cert.p12 -noout`

**"no .app found in Payload"**
- Invalid IPA structure, check with `unzip -l input.ipa`

**"embedded.mobileprovision not found"**
- Provide mobileprovision file or use adhoc signing
