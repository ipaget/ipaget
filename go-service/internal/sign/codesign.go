package sign

import (
	"bytes"
	"crypto"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"os"

	"go.mozilla.org/pkcs7"
	"software.sslmate.com/src/go-pkcs12"
)

func LoadP12Certificate(p12Path, password string) (*Certificate, []byte, crypto.PrivateKey, error) {
	p12Data, err := os.ReadFile(p12Path)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to read P12 file: %w", err)
	}

	return LoadP12CertificateFromData(p12Data, password)
}

func LoadP12CertificateFromData(p12Data []byte, password string) (*Certificate, []byte, crypto.PrivateKey, error) {
	privateKey, x509Cert, err := pkcs12.Decode(p12Data, password)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to decode P12 file: %w", err)
	}

	cert := &Certificate{
		Certificate: x509Cert.Raw,
		CommonName:  x509Cert.Subject.CommonName,
	}

	return cert, x509Cert.Raw, privateKey, nil
}

func BuildRequirementsBlob(bundleID string, subjectCN string) []byte {
	if bundleID == "" || subjectCN == "" {
		ldid := []byte{0xfa, 0xde, 0x0c, 0x01, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x00}
		return ldid
	}

	paddedBundleID := bundleID
	if len(paddedBundleID)%4 != 0 {
		paddedBundleID += string(make([]byte, 4-len(paddedBundleID)%4))
	}

	paddedSubjectCN := subjectCN
	if len(paddedSubjectCN)%4 != 0 {
		paddedSubjectCN += string(make([]byte, 4-len(paddedSubjectCN)%4))
	}

	magic1 := []byte{0xfa, 0xde, 0x0c, 0x01}
	pack1 := []byte{0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x14}
	magic2 := []byte{0xfa, 0xde, 0x0c, 0x00}
	pack2 := []byte{0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x02}
	pack3 := []byte{
		0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x0b,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x73, 0x75, 0x62, 0x6a, 0x65, 0x63, 0x74, 0x2e,
		0x43, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
	}
	pack4 := []byte{
		0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x0a, 0x2a, 0x86, 0x48, 0x86,
		0xf7, 0x63, 0x64, 0x06, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	}

	bundleIDLength := uint32(len(bundleID))
	subjectCNLength := uint32(len(subjectCN))

	length2 := uint32(len(magic2) + 4 + len(pack2))
	length2 += 4 + uint32(len(paddedBundleID))
	length2 += uint32(len(pack3))
	length2 += 4 + uint32(len(paddedSubjectCN))
	length2 += uint32(len(pack4))

	length1 := uint32(len(magic1) + 4 + len(pack1))
	length1 += length2

	buf := &bytes.Buffer{}

	binary.Write(buf, binary.BigEndian, magic1)
	binary.Write(buf, binary.BigEndian, length1)
	binary.Write(buf, binary.BigEndian, pack1)
	binary.Write(buf, binary.BigEndian, magic2)
	binary.Write(buf, binary.BigEndian, length2)
	binary.Write(buf, binary.BigEndian, pack2)
	binary.Write(buf, binary.BigEndian, bundleIDLength)
	buf.Write([]byte(paddedBundleID))
	binary.Write(buf, binary.BigEndian, pack3)
	binary.Write(buf, binary.BigEndian, subjectCNLength)
	buf.Write([]byte(paddedSubjectCN))
	binary.Write(buf, binary.BigEndian, pack4)

	return buf.Bytes()
}

func BuildCodeDirectory(
	hashType int,
	bundleID string,
	teamID string,
	executableData []byte,
	infoPlistHash []byte,
	requirementsHash []byte,
	resourcesHash []byte,
	entitlementsHash []byte,
	derEntitlementsHash []byte,
	isAdhoc bool,
	isExecutable bool,
	entitlementsBlob []byte,
) ([]byte, error) {

	version := uint32(CD_VERSION_EXECSEG)
	pageSize := uint32(4096)
	pageSizeLog2 := uint8(12)

	var hashSize uint8
	var hashTypeVal uint8
	if hashType == CS_HASHTYPE_SHA256 {
		hashSize = 32
		hashTypeVal = 2
	} else {
		hashSize = 20
		hashTypeVal = 1
	}

	codeLimit := uint32(len(executableData))
	nCodeSlots := (codeLimit + pageSize - 1) / pageSize

	var specialSlots [][]byte

	if isExecutable {
		specialSlots = [][]byte{
			derEntitlementsHash,
			nil,
			entitlementsHash,
			nil,
			resourcesHash,
			requirementsHash,
			infoPlistHash,
		}
	} else {
		specialSlots = [][]byte{
			entitlementsHash,
			nil,
			resourcesHash,
			requirementsHash,
			infoPlistHash,
		}
	}

	emptyHash := make([]byte, hashSize)
	lastUsedSlot := 0
	for i := len(specialSlots) - 1; i >= 0; i-- {
		if specialSlots[i] != nil && !bytes.Equal(specialSlots[i], emptyHash) {
			lastUsedSlot = i
			break
		}
	}
	specialSlots = specialSlots[lastUsedSlot:]
	nSpecialSlots := uint32(len(specialSlots))

	headerSize := uint32(44)
	if version >= CD_VERSION_SCATTER {
		headerSize += 4
	}
	if version >= CD_VERSION_TEAM {
		headerSize += 4
	}
	if version >= CD_VERSION_CODELIMIT {
		headerSize += 12
	}
	if version >= CD_VERSION_EXECSEG {
		headerSize += 24
	}

	identSize := uint32(len(bundleID) + 1)
	teamSize := uint32(0)
	if teamID != "" && version >= CD_VERSION_TEAM {
		teamSize = uint32(len(teamID) + 1)
	}

	hashOffset := headerSize + identSize + teamSize
	totalSize := hashOffset + uint32(hashSize)*(nSpecialSlots+nCodeSlots)

	buf := &bytes.Buffer{}

	binary.Write(buf, binary.BigEndian, uint32(CSMAGIC_CODEDIRECTORY))
	binary.Write(buf, binary.BigEndian, totalSize)
	binary.Write(buf, binary.BigEndian, version)

	flags := uint32(0)
	if isAdhoc {
		flags = CS_ADHOC
	}
	binary.Write(buf, binary.BigEndian, flags)

	binary.Write(buf, binary.BigEndian, hashOffset)
	binary.Write(buf, binary.BigEndian, headerSize)
	binary.Write(buf, binary.BigEndian, nSpecialSlots)
	binary.Write(buf, binary.BigEndian, nCodeSlots)
	binary.Write(buf, binary.BigEndian, codeLimit)

	buf.WriteByte(hashSize)
	buf.WriteByte(hashTypeVal)
	buf.WriteByte(0)
	buf.WriteByte(pageSizeLog2)

	binary.Write(buf, binary.BigEndian, uint32(0))

	if version >= CD_VERSION_SCATTER {
		binary.Write(buf, binary.BigEndian, uint32(0))
	}

	teamOffset := uint32(0)
	if teamID != "" && version >= CD_VERSION_TEAM {
		teamOffset = headerSize + identSize
	}
	if version >= CD_VERSION_TEAM {
		binary.Write(buf, binary.BigEndian, teamOffset)
	}

	if version >= CD_VERSION_CODELIMIT {
		binary.Write(buf, binary.BigEndian, uint32(0))
		binary.Write(buf, binary.BigEndian, uint64(0))
	}

	execSegLimit := uint64(codeLimit)
	execSegFlags := uint64(0)

	if isExecutable {
		if isAdhoc {
			execSegFlags = CS_EXECSEG_MAIN_BINARY
		}
	}

	if len(entitlementsBlob) > 8 && bytes.Contains(entitlementsBlob[8:], []byte("<key>get-task-allow</key>")) {
		execSegFlags |= CS_EXECSEG_MAIN_BINARY | CS_EXECSEG_ALLOW_UNSIGNED
	}

	if version >= CD_VERSION_EXECSEG {
		binary.Write(buf, binary.BigEndian, uint64(0))
		binary.Write(buf, binary.BigEndian, execSegLimit)
		binary.Write(buf, binary.BigEndian, execSegFlags)
	}

	buf.Write([]byte(bundleID))
	buf.WriteByte(0)

	if teamID != "" && version >= CD_VERSION_TEAM {
		buf.Write([]byte(teamID))
		buf.WriteByte(0)
	}

	for i := len(specialSlots) - 1; i >= 0; i-- {
		hash := specialSlots[i]
		if len(hash) == 0 {
			buf.Write(emptyHash)
		} else {
			buf.Write(hash[:hashSize])
		}
	}

	for i := uint32(0); i < nCodeSlots; i++ {
		start := i * pageSize
		end := start + pageSize
		if end > codeLimit {
			end = codeLimit
		}

		var pageHash []byte
		if hashType == CS_HASHTYPE_SHA256 {
			h := sha256.Sum256(executableData[start:end])
			pageHash = h[:]
		} else {
			h := sha1.Sum(executableData[start:end])
			pageHash = h[:]
		}

		buf.Write(pageHash)
	}

	return buf.Bytes(), nil
}

func BuildCMSSignature(codeDirectorySHA1, codeDirectorySHA256 []byte, certData []byte, privateKey crypto.PrivateKey) ([]byte, error) {
	content := append(codeDirectorySHA1, codeDirectorySHA256...)

	toBeSigned, err := pkcs7.NewSignedData(content)
	if err != nil {
		return nil, fmt.Errorf("failed to create signed data: %w", err)
	}

	cert, err := x509.ParseCertificate(certData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	appleCerts, err := getAppleCertificates(cert)
	if err != nil {
		return nil, fmt.Errorf("failed to get Apple certificates: %w", err)
	}

	for _, appleCert := range appleCerts {
		toBeSigned.AddCertificate(appleCert)
	}

	rsaKey, ok := privateKey.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key must be RSA")
	}

	if err := toBeSigned.AddSigner(cert, rsaKey, pkcs7.SignerInfoConfig{}); err != nil {
		return nil, fmt.Errorf("failed to add signer: %w", err)
	}

	toBeSigned.Detach()

	signedData, err := toBeSigned.Finish()
	if err != nil {
		return nil, fmt.Errorf("failed to finish signing: %w", err)
	}

	blob := make([]byte, 8)
	binary.BigEndian.PutUint32(blob[0:4], CSMAGIC_BLOBWRAPPER)
	binary.BigEndian.PutUint32(blob[4:8], uint32(len(signedData)+8))
	blob = append(blob, signedData...)

	return blob, nil
}

func BuildSuperBlob(slots map[uint32][]byte) []byte {
	type slotEntry struct {
		index uint32
		data  []byte
	}

	slotOrder := []uint32{
		CSSLOT_CODEDIRECTORY,
		CSSLOT_REQUIREMENTS,
		CSSLOT_ENTITLEMENTS,
		CSSLOT_DER_ENTITLEMENTS,
		0x1000,
		CSSLOT_SIGNATURESLOT,
	}

	var entries []slotEntry
	for _, idx := range slotOrder {
		if data, ok := slots[idx]; ok && len(data) > 0 {
			entries = append(entries, slotEntry{index: idx, data: data})
		}
	}

	headerSize := 12
	indexSize := 8 * len(entries)
	offset := uint32(headerSize + indexSize)

	buf := &bytes.Buffer{}

	binary.Write(buf, binary.BigEndian, uint32(CSMAGIC_EMBEDDED_SIGNATURE))
	binary.Write(buf, binary.BigEndian, uint32(0))
	binary.Write(buf, binary.BigEndian, uint32(len(entries)))

	dataSection := &bytes.Buffer{}

	for _, entry := range entries {
		binary.Write(buf, binary.BigEndian, entry.index)
		binary.Write(buf, binary.BigEndian, offset)

		dataSection.Write(entry.data)
		offset += uint32(len(entry.data))
	}

	result := buf.Bytes()
	result = append(result, dataSection.Bytes()...)

	binary.BigEndian.PutUint32(result[4:8], uint32(len(result)))

	return result
}

func hashData(data []byte, hashType int) []byte {
	if hashType == CS_HASHTYPE_SHA256 {
		h := sha256.Sum256(data)
		return h[:]
	}
	h := sha1.Sum(data)
	return h[:]
}

const appleWWDRCA = `-----BEGIN CERTIFICATE-----
MIIEIjCCAwqgAwIBAgIIAd68xDltoBAwDQYJKoZIhvcNAQEFBQAwYjELMAkGA1UE
BhMCVVMxEzARBgNVBAoTCkFwcGxlIEluYy4xJjAkBgNVBAsTHUFwcGxlIENlcnRp
ZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQDEw1BcHBsZSBSb290IENBMB4XDTEz
MDIwNzIxNDg0N1oXDTIzMDIwNzIxNDg0N1owgZYxCzAJBgNVBAYTAlVTMRMwEQYD
VQQKDApBcHBsZSBJbmMuMSwwKgYDVQQLDCNBcHBsZSBXb3JsZHdpZGUgRGV2ZWxv
cGVyIFJlbGF0aW9uczFEMEIGA1UEAww7QXBwbGUgV29ybGR3aWRlIERldmVsb3Bl
ciBSZWxhdGlvbnMgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQDKOFSmy1aqyCQ5SOmM7uxfuH8mkbw0U3rOfGOA
YXdkXqUHI7Y5/lAtFVZYcC1+xG7BSoU+L/DehBqhV8mvexj/avoVEkkVCBmsqtsq
Mu2WY2hSFT2Miuy/axiV4AOsAX2XBWfODoWVN2rtCbauZ81RZJ/GXNG8V25nNYB2
NqSHgW44j9grFU57Jdhav06DwY3Sk9UacbVgnJ0zTlX5ElgMhrgWDcHld0WNUEi6
Ky3klIXh6MSdxmilsKP8Z35wugJZS3dCkTm59c3hTO/AO0iMpuUhXf1qarunFjVg
0uat80YpyejDi+l5wGphZxWy8P3laLxiX27Pmd3vG2P+kmWrAgMBAAGjgaYwgaMw
HQYDVR0OBBYEFIgnFwmpthhgi+zruvZHWcVSVKO3MA8GA1UdEwEB/wQFMAMBAf8w
HwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wLgYDVR0fBCcwJTAjoCGg
H4YdaHR0cDovL2NybC5hcHBsZS5jb20vcm9vdC5jcmwwDgYDVR0PAQH/BAQDAgGG
MBAGCiqGSIb3Y2QGAgEEAgUAMA0GCSqGSIb3DQEBBQUAA4IBAQBPz+9Zviz1smwv
j+4ThzLoBTWobot9yWkMudkXvHcs1Gfi/ZptOllc34MBvbKuKmFysa/Nw0Uwj6OD
Dc4dR7Txk4qjdJukw5hyhzs+r0ULklS5MruQGFNrCk4QttkdUGwhgAqJTleMa1s8
Pab93vcNIx0LSiaHP7qRkkykGRIZbVf1eliHe2iK5IaMSuviSRSqpd1VAKmuu0sw
ruGgsbwpgOYJd+W+NKIByn/c4grmO7i77LpilfMFY0GCzQ87HUyVpNur+cmV6U/k
TecmmYHpvPm0KdIBembhLoz2IYrF+Hjhga6/05Cdqa3zr/04GpZnMBxRpVzscYqC
tGwPDBUf
-----END CERTIFICATE-----`

const appleWWDRCAG3 = `-----BEGIN CERTIFICATE-----
MIIEUTCCAzmgAwIBAgIQfK9pCiW3Of57m0R6wXjF7jANBgkqhkiG9w0BAQsFADBi
MQswCQYDVQQGEwJVUzETMBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBw
bGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxFjAUBgNVBAMTDUFwcGxlIFJvb3Qg
Q0EwHhcNMjAwMjE5MTgxMzQ3WhcNMzAwMjIwMDAwMDAwWjB1MUQwQgYDVQQDDDtB
cHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTELMAkGA1UECwwCRzMxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJ
BgNVBAYTAlVTMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2PWJ/KhZ
C4fHTJEuLVaQ03gdpDDppUjvC0O/LYT7JF1FG+XrWTYSXFRknmxiLbTGl8rMPPbW
BpH85QKmHGq0edVny6zpPwcR4YS8Rx1mjjmi6LRJ7TrS4RBgeo6TjMrA2gzAg9Dj
+ZHWp4zIwXPirkbRYp2SqJBgN31ols2N4Pyb+ni743uvLRfdW/6AWSN1F7gSwe0b
5TTO/iK1nkmw5VW/j4SiPKi6xYaVFuQAyZ8D0MyzOhZ71gVcnetHrg21LYwOaU1A
0EtMOwSejSGxrC5DVDDOwYqGlJhL32oNP/77HK6XF8J4CjDgXx9UO0m3JQAaN4LS
VpelUkl8YDib7wIDAQABo4HvMIHsMBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0j
BBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wRAYIKwYBBQUHAQEEODA2MDQGCCsG
AQUFBzABhihodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNh
MC4GA1UdHwQnMCUwI6AhoB+GHWh0dHA6Ly9jcmwuYXBwbGUuY29tL3Jvb3QuY3Js
MB0GA1UdDgQWBBQJ/sAVkPmvZAqSErkmKGMMl+ynsjAOBgNVHQ8BAf8EBAMCAQYw
EAYKKoZIhvdjZAYCAQQCBQAwDQYJKoZIhvcNAQELBQADggEBAK1lE+j24IF3RAJH
Qr5fpTkg6mKp/cWQyXMT1Z6b0KoPjY3L7QHPbChAW8dVJEH4/M/BtSPp3Ozxb8qA
HXfCxGFJJWevD8o5Ja3T43rMMygNDi6hV0Bz+uZcrgZRKe3jhQxPYdwyFot30ETK
XXIDMUacrptAGvr04NM++i+MZp+XxFRZ79JI9AeZSWBZGcfdlNHAwWx/eCHvDOs7
bJmCS1JgOLU5gm3sUjFTvg+RTElJdI+mUcuER04ddSduvfnSXPN/wmwLCTbiZOTC
NwMUGdXqapSqqdv+9poIZ4vvK7iqF0mDr8/LvOnP6pVxsLRFoszlh6oKw0E6eVza
UDSdlTs=
-----END CERTIFICATE-----`

const appleRootCA = `-----BEGIN CERTIFICATE-----
MIIEuzCCA6OgAwIBAgIBAjANBgkqhkiG9w0BAQUFADBiMQswCQYDVQQGEwJVUzET
MBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlv
biBBdXRob3JpdHkxFjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwHhcNMDYwNDI1MjE0
MDM2WhcNMzUwMjA5MjE0MDM2WjBiMQswCQYDVQQGEwJVUzETMBEGA1UEChMKQXBw
bGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkx
FjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
ggEKAoIBAQDkkakJH5HbHkdQ6wXtXnmELes2oldMVeyLGYne+Uts9QerIjAC6Bg+
+FAJ039BqJj50cpmnCRrEdCju+QbKsMflZ56DKRHi1vUFjczy8QPTc4UadHJGXL1
XQ7Vf1+b8iUDulWPTV0N8WQ1IxVLFVkds5T39pyez1C6wVhQZ48ItCD3y6wsIG9w
tj8BMIy3Q88PnT3zK0koGsj+zrW5DtleHNbLPbU6rfQPDgCSC7EhFi501TwN22IW
q6NxkkdTVcGvL0Gz+PvjcM3mo0xFfh9Ma1CWQYnEdGILEINBhzOKgbEwWOxaBDKM
aLOPHd5lc/9nXmW8Sdh2nzMUZaF3lMktAgMBAAGjggF6MIIBdjAOBgNVHQ8BAf8E
BAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUK9BpR5R2Cf70a40uQKb3
R01/CF4wHwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wggERBgNVHSAE
ggEIMIIBBDCCAQAGCSqGSIb3Y2QFATCB8jAqBggrBgEFBQcCARYeaHR0cHM6Ly93
d3cuYXBwbGUuY29tL2FwcGxlY2EvMIHDBggrBgEFBQcCAjCBthqBs1JlbGlhbmNl
IG9uIHRoaXMgY2VydGlmaWNhdGUgYnkgYW55IHBhcnR5IGFzc3VtZXMgYWNjZXB0
YW5jZSBvZiB0aGUgdGhlbiBhcHBsaWNhYmxlIHN0YW5kYXJkIHRlcm1zIGFuZCBj
b25kaXRpb25zIG9mIHVzZSwgY2VydGlmaWNhdGUgcG9saWN5IGFuZCBjZXJ0aWZp
Y2F0aW9uIHByYWN0aWNlIHN0YXRlbWVudHMuMA0GCSqGSIb3DQEBBQUAA4IBAQBc
NplMLXi37Yyb3PN3m/J20ncwT8EfhYOFG5k9RzfyqZtAjizUsZAS2L70c5vu0mQP
y3lPNNiiPvl4/2vIB+x9OYOLUyDTOMSxv5pPCmv/K/xZpwUJfBdAVhEedNO3iyM7
R6PVbyTi69G3cN8PReEnyvFteO3ntRcXqNx+IjXKJdXZD9Zr1KIkIxH3oayPc4Fg
xhtbCS+SsvhESPBgOJ4V9T0mZyCKM2r3DYLP3uujL/lTaltkwGMzd/c6ByxW69oP
IQ7aunMZT7XZNn/Bh1XZp5m5MkL72NVxnn6hUrcbvZNCJBIqxw8dtk2cXmPIS4AX
UKqK1drk/NAJBzewdXUh
-----END CERTIFICATE-----`

func getAppleCertificates(cert *x509.Certificate) ([]*x509.Certificate, error) {
	issuerHash := computeIssuerNameHash(cert)

	var intermediateCert *x509.Certificate
	var err error

	if issuerHash == 0x817d2f7a {
		intermediateCert, err = parsePEMCertificate(appleWWDRCA)
	} else if issuerHash == 0x3729dfea || issuerHash == 0x9b16b75c {
		intermediateCert, err = parsePEMCertificate(appleWWDRCAG3)
	} else {
		return nil, fmt.Errorf("unknown issuer hash: 0x%x", issuerHash)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to parse intermediate certificate: %w", err)
	}

	rootCert, err := parsePEMCertificate(appleRootCA)
	if err != nil {
		return nil, fmt.Errorf("failed to parse root certificate: %w", err)
	}

	return []*x509.Certificate{intermediateCert, rootCert}, nil
}

func computeIssuerNameHash(cert *x509.Certificate) uint32 {
	issuerDN := cert.Issuer.ToRDNSequence().String()
	h := sha1.Sum([]byte(issuerDN))
	return binary.LittleEndian.Uint32(h[:4])
}

func parsePEMCertificate(pemData string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(pemData))
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	return x509.ParseCertificate(block.Bytes)
}
