package store

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/99designs/keyring"
	cookiejar "github.com/juju/persistent-cookiejar"
	"github.com/majd/ipatool/v2/pkg/appstore"
	ipatoolKeychain "github.com/majd/ipatool/v2/pkg/keychain"
	"github.com/majd/ipatool/v2/pkg/util/machine"
	"github.com/majd/ipatool/v2/pkg/util/operatingsystem"
)

type versionProbeKeychain struct {
	base ipatoolKeychain.Keychain
	mu sync.Mutex
	values map[string][]byte
	removed map[string]bool
	fresh bool
}

func (keychain *versionProbeKeychain) Get(key string) ([]byte, error) {
	keychain.mu.Lock()
	defer keychain.mu.Unlock()
	if value, ok := keychain.values[key]; ok {
		return value, nil
	}
	if keychain.removed[key] || (keychain.fresh && key == "kbsync-v1") {
		return nil, errors.New("cache unavailable in read-only probe")
	}
	return keychain.base.Get(key)
}

func (keychain *versionProbeKeychain) Set(key string, value []byte) error {
	keychain.mu.Lock()
	defer keychain.mu.Unlock()
	keychain.values[key] = append([]byte(nil), value...)
	delete(keychain.removed, key)
	return nil
}

func (keychain *versionProbeKeychain) Remove(key string) error {
	keychain.mu.Lock()
	defer keychain.mu.Unlock()
	delete(keychain.values, key)
	keychain.removed[key] = true
	return nil
}

type versionProbeCookieJar struct { http.CookieJar }

func (jar versionProbeCookieJar) Save() error { return nil }

func TestVersionsLiveReadOnly(t *testing.T) {
	if os.Getenv("IPAGET_TEST_VERSIONS_LIVE") != "1" {
		t.Skip("set IPAGET_TEST_VERSIONS_LIVE=1 and IPAGET_TEST_ACCOUNT for a read-only version query")
	}
	email := os.Getenv("IPAGET_TEST_ACCOUNT")
	if email == "" {
		t.Fatal("IPAGET_TEST_ACCOUNT must name an existing saved account")
	}
	configDir := filepath.Join(os.Getenv("APPDATA"), "iPAGet")
	ring, err := keyring.Open(keyring.Config{
		AllowedBackends: []keyring.BackendType{keyring.KeychainBackend, keyring.SecretServiceBackend, keyring.FileBackend},
		ServiceName: keychainServiceName, FileDir: configDir,
		FilePasswordFunc: func(string) (string, error) { return "ipaget-keychain-passphrase", nil },
	})
	if err != nil {
		t.Fatal("cannot open saved keyring")
	}
	probeKeychain := &versionProbeKeychain{
		base: ipatoolKeychain.New(ipatoolKeychain.Args{Keyring: &ipatoolKeyringAdapter{keyring: ring}}),
		values: make(map[string][]byte), removed: make(map[string]bool),
		fresh: os.Getenv("IPAGET_TEST_VERSIONS_FRESH") == "1",
	}
	service := &Service{keychain: probeKeychain}
	account, err := service.loadStoredAccount(email)
	if err != nil || !hasUsableAppStoreSession(account) {
		t.Fatal("a complete saved App Store session is required; this test never signs in")
	}
	jar, err := cookiejar.New(&cookiejar.Options{Filename: filepath.Join(configDir, "cookies.json")})
	if err != nil {
		t.Fatal("cannot open saved cookies")
	}
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.Proxy = func(request *http.Request) (*url.URL, error) {
		t.Logf("request: %s %s%s; token=%t; cookies=%d", request.Method,
			request.URL.Host, request.URL.Path, request.Header.Get("X-Token") != "", len(request.Cookies()))
		return nil, nil
	}
	original := http.DefaultTransport
	http.DefaultTransport = base
	t.Cleanup(func() { http.DefaultTransport = original; base.CloseIdleConnections() })
	osInstance := operatingsystem.New()
	client := appstore.NewAppStore(appstore.Args{
		Keychain: service.keychain, CookieJar: versionProbeCookieJar{jar}, OperatingSystem: osInstance,
		Machine: machine.New(machine.Args{OS: osInstance}),
	})
	bundleID := os.Getenv("IPAGET_TEST_BUNDLE_ID")
	if bundleID == "" {
		bundleID = "com.facebook.hatch"
	}
	lookup, err := client.Lookup(appstore.LookupInput{Account: *account, BundleID: bundleID})
	if err != nil {
		t.Fatalf("lookup failed: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	versions, err := client.ListVersions(appstore.ListVersionsInput{Context: ctx, Account: *account, App: lookup.App})
	if err != nil {
		t.Fatalf("version query failed: %v", err)
	}
	if len(versions.ExternalVersionIdentifiers) == 0 {
		t.Fatal("version query returned an empty list")
	}
	t.Logf("received %d version identifiers", len(versions.ExternalVersionIdentifiers))
}