package sign

import "time"

type ProvisioningProfile struct {
	Filename     string
	Name         string
	Created      time.Time
	Expires      time.Time
	AppID        string
	TeamID       string
	Entitlements map[string]interface{}
	Path         string
	rawData      []byte
}

type SignerOptions struct {
	InputPath        string
	OutputPath       string
	P12File          string
	P12Password      string
	ProvisionFile    string
	NewBundleID      string
	NewBundleName    string
	NewBundleVersion string
	EntitlementsFile string
	Entitlements     map[string]interface{}
	DylibFiles       []string
	TempFolder       string
	ZipLevel         int
	Force            bool
	WeakInject       bool
	SHA256Only       bool
	PreserveMetadata bool
	Debug            bool
	DebugFolder      string
}

type Certificate struct {
	Certificate []byte
	PrivateKey  []byte
	CommonName  string
}

type CodeSignature struct {
	CodeDirectory          []byte
	AlternateCodeDirectory []byte
	Requirements           []byte
	Entitlements           []byte
	DerEntitlements        []byte
	CMSSignature           []byte
}

type MachOBinary struct {
	Path          string
	Data          []byte
	Offset        uint64
	IsFat         bool
	Architectures []MachOArch
}

type MachOArch struct {
	CPUType    uint32
	CPUSubType uint32
	Offset     uint64
	Size       uint64
	Align      uint32
}

const (
	CSMAGIC_REQUIREMENT               = 0xfade0c00
	CSMAGIC_REQUIREMENTS              = 0xfade0c01
	CSMAGIC_CODEDIRECTORY             = 0xfade0c02
	CSMAGIC_EMBEDDED_SIGNATURE        = 0xfade0cc0
	CSMAGIC_DETACHED_SIGNATURE        = 0xfade0cc1
	CSMAGIC_BLOBWRAPPER               = 0xfade0b01
	CSMAGIC_EMBEDDED_ENTITLEMENTS     = 0xfade7171
	CSMAGIC_EMBEDDED_DER_ENTITLEMENTS = 0xfade7172

	CSSLOT_CODEDIRECTORY    = 0
	CSSLOT_INFOSLOT         = 1
	CSSLOT_REQUIREMENTS     = 2
	CSSLOT_RESOURCEDIR      = 3
	CSSLOT_APPLICATION      = 4
	CSSLOT_ENTITLEMENTS     = 5
	CSSLOT_DER_ENTITLEMENTS = 7
	CSSLOT_SIGNATURESLOT    = 0x10000

	CS_HASHTYPE_SHA1             = 1
	CS_HASHTYPE_SHA256           = 2
	CS_HASHTYPE_SHA256_TRUNCATED = 3
	CS_HASHTYPE_SHA384           = 4

	CS_ADHOC = 0x00000002

	CS_EXECSEG_MAIN_BINARY    = 0x001
	CS_EXECSEG_ALLOW_UNSIGNED = 0x010

	CD_VERSION_EARLIEST  = 0x20001
	CD_VERSION_SCATTER   = 0x20100
	CD_VERSION_TEAM      = 0x20200
	CD_VERSION_CODELIMIT = 0x20300
	CD_VERSION_EXECSEG   = 0x20400
)
