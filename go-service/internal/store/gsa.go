package store

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"hash"
	"time"

	"ipaget-service/internal/logger"

	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

// AppleLoginContext represents the Apple GSA login context
type AppleLoginContext struct {
	Exchange hash.Hash
	Proto    []string
	srp      *SRPClient
	UserName []byte
	Password []byte
	CPD      *GSARequestCPD
	DCH      bool
	SC       []byte
	// Header/CPD overrides from Anisette
	HeaderXMMEClientInfo string
	HeaderAcceptLanguage string
	HeaderAppleLocale    string
	HeaderAppleTimeZone  string
	// CPD fields matching Sidestore's clientDictionary
	CPDSerialNumber string
	CPDClientTime   string
	CPDRInfo        uint64 // Must be uint64 to match SideStore's NSUInteger (unsigned long long)
	CPDLocale       string
	CPDTimeZone     string
	CPDMDLU         string
}

// NewLoginSession creates a new login session
func NewLoginSession(username, password string) *AppleLoginContext {
	context := new(AppleLoginContext)
	param := GetParams(2048)
	param.NoUserNameInX = true
	context.srp = NewSRPClient(param, nil)
	context.UserName = []byte(username)
	context.Password = []byte(password)
	context.Exchange = sha256.New()
	return context
}

// SetAnisetteOverrides configures context from persisted Anisette data
// Must populate all fields that Sidestore's clientDictionary contains
func (ctx *AppleLoginContext) SetAnisetteOverrides(a *AnisetteStored) {
	if a == nil {
		return
	}
	ctx.HeaderXMMEClientInfo = a.DeviceDescription
	ctx.HeaderAcceptLanguage = toAcceptLanguage(a.Locale)
	ctx.HeaderAppleLocale = a.Locale
	ctx.HeaderAppleTimeZone = a.TimeZone
	ctx.CPDSerialNumber = a.DeviceSerialNumber
	ctx.CPDClientTime = a.ClientTime
	ctx.CPDLocale = a.Locale
	ctx.CPDTimeZone = a.TimeZone
	ctx.CPDMDLU = a.LocalUserID
	// routingInfo may be numeric in string form - parse as uint64 to match SideStore
	if n, err := strconv.ParseUint(strings.TrimSpace(a.RoutingInfo), 10, 64); err == nil {
		ctx.CPDRInfo = n
	}
}

// UpdateNegData updates negotiation data
func (ctx *AppleLoginContext) UpdateNegData(data []byte) {
	buf := new(bytes.Buffer)
	binary.Write(buf, binary.LittleEndian, uint32(len(data)))
	ctx.Exchange.Write(buf.Bytes())
	ctx.Exchange.Write(data)
}

// UpdateNegString updates negotiation string
func (ctx *AppleLoginContext) UpdateNegString(s string) {
	ctx.Exchange.Write([]byte(s))
}

// createSessionKey creates a session key from the SRP session key
func (ctx *AppleLoginContext) createSessionKey(keyname string) []byte {
	skey := ctx.srp.GetSessionKey()
	mac := hmac.New(sha256.New, skey)
	mac.Write([]byte(keyname))
	expectedMAC := mac.Sum(nil)
	return expectedMAC
}

// Decrypt decrypts SRP transmitted data
func (ctx *AppleLoginContext) Decrypt(spd []byte) ([]byte, error) {
	key := ctx.createSessionKey("extra data key:")
	iv := ctx.createSessionKey("extra data iv:")
	return DecryptCBC(key, iv, spd)
}

// LoginStep1 performs the first login step
func (ctx *AppleLoginContext) LoginStep1(udid, imd, imdm, cid string) (*GSAStep1Response, error) {
	logger.Debug().Str("udid", udid).Str("cid", cid).Str("imd", imd).Str("imdm", imdm).Msg("GSA LoginStep1")

	var req GSAStep1Request
	var cpd GSARequestCPD
	{
		req.A2K = ctx.srp.A.Bytes()
		logger.Debug().Int("a2k_len", len(req.A2K)).Str("a2k_hex", fmt.Sprintf("%x", req.A2K[:32])).Msg("SRP A generated")

		// Fill CPD matching Sidestore's clientDictionary exactly (lines 38-54)
		// These boolean flags must match Sidestore
		cpd.BootStrap = true
		cpd.ICSCrec = true
		cpd.PBE = false
		cpd.PRKGEN = true
		cpd.SVCT = "iCloud"

		// Locale settings
		if strings.TrimSpace(ctx.CPDLocale) != "" {
			cpd.Loc = ctx.CPDLocale
			cpd.XAppleLocale = ctx.CPDLocale
		} else {
			cpd.Loc = "en_US"
			cpd.XAppleLocale = "en_US"
		}

		// Anisette data
		cpd.IMD = imd
		cpd.IMDM = imdm
		cpd.UDID = udid
		cpd.IMDLU = ctx.CPDMDLU
		if ctx.CPDRInfo > 0 {
			cpd.RInfo = ctx.CPDRInfo
		} else {
			cpd.RInfo = 17106176
		}
		if strings.TrimSpace(ctx.CPDSerialNumber) != "" {
			cpd.SerialNumber = ctx.CPDSerialNumber
		}

		// Time settings
		if strings.TrimSpace(ctx.CPDClientTime) != "" {
			cpd.ClientTime = ctx.CPDClientTime
		} else {
			cpd.ClientTime = time.Now().UTC().Format("2006-01-02T15:04:05Z")
		}
		if strings.TrimSpace(ctx.CPDTimeZone) != "" {
			cpd.TimeZone = ctx.CPDTimeZone
		} else {
			cpd.TimeZone = "UTC"
		}

		// NOTE: Do NOT set CID or CKGen - Sidestore's clientDictionary does NOT include these!
		// Setting them would cause CPD mismatch between GSA login and apptokens request

		ctx.CPD = &cpd

		// Debug: Log all CPD fields for comparison with apptokens request
		logger.Debug().
			Bool("bootstrap", cpd.BootStrap).
			Bool("icscrec", cpd.ICSCrec).
			Bool("pbe", cpd.PBE).
			Bool("prkgen", cpd.PRKGEN).
			Str("svct", cpd.SVCT).
			Str("loc", cpd.Loc).
			Str("X-Apple-Locale", cpd.XAppleLocale).
			Str("X-Apple-I-MD", cpd.IMD[:min(20, len(cpd.IMD))]+"...").
			Str("X-Apple-I-MD-M", cpd.IMDM[:min(20, len(cpd.IMDM))]+"...").
			Str("X-Mme-Device-Id", cpd.UDID).
			Str("X-Apple-I-MD-LU", cpd.IMDLU).
			Uint64("X-Apple-I-MD-RINFO", cpd.RInfo).
			Str("X-Apple-I-SRL-NO", cpd.SerialNumber).
			Str("X-Apple-I-Client-Time", cpd.ClientTime).
			Str("X-Apple-I-TimeZone", cpd.TimeZone).
			Msg("GSA LoginStep1 CPD fields (for comparison with apptokens)")
	}
	req.CPD = &cpd
	req.ProtoStyle = []string{"s2k", "s2k_fo"}
	req.UserName = string(ctx.UserName)
	req.Operation = "init"

	for i, name := range req.ProtoStyle {
		ctx.UpdateNegString(name)
		if i != len(req.ProtoStyle)-1 {
			ctx.UpdateNegString(",")
		}
	}
	ctx.UpdateNegString("|")
	if ctx.DCH {
		ctx.UpdateNegString("DisregardChannelBindings")
	}

	headers := GSAHeaders{
		XMMEClientInfo: ctx.HeaderXMMEClientInfo,
		AcceptLanguage: ctx.HeaderAcceptLanguage,
		XAppleLocale:   ctx.HeaderAppleLocale,
		XAppleTimeZone: ctx.HeaderAppleTimeZone,
	}
	resp, err := PostLoginStep1Request(&req, headers)
	if err != nil {
		return nil, fmt.Errorf("step1 request failed: %w", err)
	}

	return resp, nil
}

// LoginStep2 performs the second login step
func (ctx *AppleLoginContext) LoginStep2(m1 []byte, c string, sp string) (*GSAStep2Response, error) {
	var req GSAStep2Request
	req.CPD = *ctx.CPD
	req.M1 = m1
	req.Operation = "complete"
	req.Complete = c
	req.UserName = string(ctx.UserName)
	ctx.UpdateNegString("|")
	ctx.UpdateNegString(sp)

	headers := GSAHeaders{
		XMMEClientInfo: ctx.HeaderXMMEClientInfo,
		AcceptLanguage: ctx.HeaderAcceptLanguage,
		XAppleLocale:   ctx.HeaderAppleLocale,
		XAppleTimeZone: ctx.HeaderAppleTimeZone,
	}
	resp, err := PostLoginStep2Request(&req, headers)
	if err != nil {
		return nil, fmt.Errorf("step2 request failed: %w", err)
	}

	return resp, nil
}

// HandleStep1 handles the first step response and returns M1
func (ctx *AppleLoginContext) HandleStep1(resp *GSAStep1Response) ([]byte, error) {
	if resp == nil {
		return nil, fmt.Errorf("response is nil")
	}

	logger.Debug().Str("protocol", resp.ServerProto).Int("iteration", resp.IterationCount).Int("salt_len", len(resp.Salt)).Int("server_b_len", len(resp.SRPB)).Msg("GSA HandleStep1")

	salt := resp.Salt
	iter := resp.IterationCount
	nots2k := true
	if resp.ServerProto == "s2k" {
		nots2k = false
	}
	logger.Debug().Bool("s2k_fo_mode", nots2k).Msg("SRP mode selected")

	key := SRPPassword(sha256.New, nots2k, string(ctx.Password), salt, iter)
	logger.Debug().Int("key_len", len(key)).Msg("Key derived")

	ctx.srp.ProcessClientChallenge(ctx.UserName, key, salt, resp.SRPB)
	m1 := ctx.srp.GetM1Bytes()
	logger.Debug().Int("m1_len", len(m1)).Str("m1_hex", fmt.Sprintf("%x", m1)).Msg("M1 computed")

	return m1, nil
}

// HandleStep2 handles the second step response
func (ctx *AppleLoginContext) HandleStep2(resp *GSAStep2Response) ([]byte, error) {
	logger.Debug().Int("spd_len", len(resp.SPD)).Int("m2_len", len(resp.M2)).Msg("GSA HandleStep2")

	ctx.UpdateNegString("|")
	ctx.UpdateNegData(resp.SPD)
	ctx.UpdateNegString("|")
	if len(ctx.SC) > 0 {
		ctx.UpdateNegData(ctx.SC)
	}
	ctx.UpdateNegString("|")
	if len(resp.SPD) > 0 {
		decrypted, err := ctx.Decrypt(resp.SPD)
		if err == nil {
			preview := string(decrypted)
			if len(decrypted) > 100 {
				preview = string(decrypted[:100]) + "..."
			}
			logger.Debug().Int("decrypted_len", len(decrypted)).Str("spd_preview", preview).Msg("SPD decrypted")
		}
		return decrypted, err
	}
	return nil, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// SRPPassword computes SRP P field, password derived from plain text through multiple sha256 iterations
// s2kfo: if sp field not equal to s2k, set to true
func SRPPassword(h func() hash.Hash, s2kfo bool, password string, salt []byte, iterationcount int) []byte {
	hashPass := sha256.New()
	hashPass.Write([]byte(password))
	var digest []byte
	if s2kfo {
		digest = []byte(hex.EncodeToString(hashPass.Sum(nil)))
	} else {
		digest = hashPass.Sum(nil)
	}
	return pbkdf2.Key(digest, salt, iterationcount, h().Size(), h)
}

// GSALogin performs the complete GSA login flow
func GSALogin(username, password string, udid, imd, imdm, cid string) (*GSAStatus, []byte, error) {
	context := NewLoginSession(username, password)
	var status GSAStatus

	// Step 1: Init
	resp, err := context.LoginStep1(udid, imd, imdm, cid)
	if err != nil {
		return nil, nil, fmt.Errorf("login step1 failed: %w", err)
	}

	if resp.Status.ErrorCode != 0 {
		return &resp.Status, nil, nil
	}

	// Handle Step 1 response
	m1, err := context.HandleStep1(resp)
	if err != nil {
		status.ErrorCode = 1000
		status.ErrorMessage = "internal error: failed to handle step1"
		return &status, nil, fmt.Errorf("handle step1 failed: %w", err)
	}

	if len(m1) == 0 {
		status.ErrorCode = 1000
		status.ErrorMessage = "internal error: M1 is empty"
		return &status, nil, fmt.Errorf("M1 calculation failed")
	}

	c := resp.Complete
	sp := resp.ServerProto

	// Step 2: Complete
	resp2, err := context.LoginStep2(m1, c, sp)
	if err != nil {
		return nil, nil, fmt.Errorf("login step2 failed: %w", err)
	}

	if resp2.Status.ErrorCode != 0 {
		return &resp2.Status, nil, nil
	}

	logger.Debug().
		Int("status_code", resp2.Status.StatusCode).
		Str("auth_type", resp2.Status.AuthType).
		Msg("GSA Step2 status parsed")

	// Verify M2
	M2 := resp2.M2
	if hex.EncodeToString(M2) != hex.EncodeToString(context.srp.M2) {
		status.ErrorCode = 1001
		status.ErrorMessage = "m2 check failed"
		return &status, nil, fmt.Errorf("SRP M2 verification failed")
	}

	// Decrypt SPD
	if len(resp2.SPD) > 0 {
		dict, err := context.HandleStep2(resp2)
		if err != nil {
			status.ErrorCode = 1002
			status.ErrorMessage = "failed to decrypt spd"
			return &status, nil, fmt.Errorf("handle step2 failed: %w", err)
		}
		resp2.Status.ErrorCode = 0
		return &resp2.Status, dict, nil
	}

	status.ErrorCode = 1002
	status.ErrorMessage = "unknown error"
	return &status, nil, fmt.Errorf("no SPD in response")
}

// GSALoginFull performs GSA login using optional anisette overrides for CPD and headers
func GSALoginFull(username, password string, udid, imd, imdm, cid string, anisette *AnisetteStored) (*GSAStatus, []byte, error) {
	context := NewLoginSession(username, password)
	if anisette != nil {
		context.SetAnisetteOverrides(anisette)
	}
	var status GSAStatus

	// Step 1: Init
	resp, err := context.LoginStep1(udid, imd, imdm, cid)
	if err != nil {
		return nil, nil, fmt.Errorf("login step1 failed: %w", err)
	}

	if resp.Status.ErrorCode != 0 {
		return &resp.Status, nil, nil
	}

	// Handle Step 1 response
	m1, err := context.HandleStep1(resp)
	if err != nil {
		status.ErrorCode = 1000
		status.ErrorMessage = "internal error: failed to handle step1"
		return &status, nil, fmt.Errorf("handle step1 failed: %w", err)
	}

	if len(m1) == 0 {
		status.ErrorCode = 1000
		status.ErrorMessage = "internal error: M1 is empty"
		return &status, nil, fmt.Errorf("M1 calculation failed")
	}

	c := resp.Complete
	sp := resp.ServerProto

	// Step 2: Complete
	resp2, err := context.LoginStep2(m1, c, sp)
	if err != nil {
		return nil, nil, fmt.Errorf("login step2 failed: %w", err)
	}

	if resp2.Status.ErrorCode != 0 {
		return &resp2.Status, nil, nil
	}

	logger.Debug().
		Int("status_code", resp2.Status.StatusCode).
		Str("auth_type", resp2.Status.AuthType).
		Msg("GSA Step2 status parsed")

	// Verify M2
	M2 := resp2.M2
	if hex.EncodeToString(M2) != hex.EncodeToString(context.srp.M2) {
		status.ErrorCode = 1001
		status.ErrorMessage = "m2 check failed"
		return &status, nil, fmt.Errorf("SRP M2 verification failed")
	}

	// Decrypt SPD
	if len(resp2.SPD) > 0 {
		dict, err := context.HandleStep2(resp2)
		if err != nil {
			status.ErrorCode = 1002
			status.ErrorMessage = "failed to decrypt spd"
			return &status, nil, fmt.Errorf("handle step2 failed: %w", err)
		}
		resp2.Status.ErrorCode = 0
		return &resp2.Status, dict, nil
	}

	status.ErrorCode = 1002
	status.ErrorMessage = "unknown error"
	return &status, nil, fmt.Errorf("no SPD in response")
}
