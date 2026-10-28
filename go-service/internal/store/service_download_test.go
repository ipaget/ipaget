package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/majd/ipatool/v2/pkg/appstore"
)

type downloadTestAppStore struct {
	appstore.AppStore
	lookup   func(appstore.LookupInput) (appstore.LookupOutput, error)
	download func(appstore.DownloadInput) (appstore.DownloadOutput, error)
	purchase func(appstore.PurchaseInput) error
}

func (client *downloadTestAppStore) Lookup(input appstore.LookupInput) (appstore.LookupOutput, error) {
	return client.lookup(input)
}

func (client *downloadTestAppStore) Download(input appstore.DownloadInput) (appstore.DownloadOutput, error) {
	return client.download(input)
}

func (client *downloadTestAppStore) Purchase(input appstore.PurchaseInput) error {
	if client.purchase == nil {
		return errors.New("purchase was not expected")
	}
	return client.purchase(input)
}

func TestDownloadPropagatesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	email := "download@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	account, err := json.Marshal(appstore.Account{
		Email:               email,
		PasswordToken:       "test-token",
		DirectoryServicesID: "test-dsid",
		StoreFront:          "143441-1,29",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.keychain.Set(service.getAccountKey(email), account); err != nil {
		t.Fatal(err)
	}
	service.appStore = &downloadTestAppStore{
		lookup: func(input appstore.LookupInput) (appstore.LookupOutput, error) {
			return appstore.LookupOutput{App: appstore.App{BundleID: input.BundleID}}, nil
		},
		download: func(input appstore.DownloadInput) (appstore.DownloadOutput, error) {
			if input.Context != ctx {
				t.Error("download did not receive the task cancellation context")
			}
			cancel()
			return appstore.DownloadOutput{}, context.Canceled
		},
	}
	if err := service.Download(ctx, DownloadOptions{
		BundleID:  "test.download",
		Email:     email,
		OutputDir: t.TempDir(),
	}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestDownloadPinsRequestedBuildAcrossAttempts(t *testing.T) {
	ctx := context.Background()
	email := "download@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	account, err := json.Marshal(appstore.Account{
		Email:               email,
		PasswordToken:       "test-token",
		DirectoryServicesID: "test-dsid",
		StoreFront:          "143441-1,29",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.keychain.Set(service.getAccountKey(email), account); err != nil {
		t.Fatal(err)
	}

	var requested []string
	service.appStore = &downloadTestAppStore{
		lookup: func(input appstore.LookupInput) (appstore.LookupOutput, error) {
			return appstore.LookupOutput{App: appstore.App{BundleID: input.BundleID}}, nil
		},
		download: func(input appstore.DownloadInput) (appstore.DownloadOutput, error) {
			requested = append(requested, input.ExternalVersionID)
			return appstore.DownloadOutput{}, errors.New("inspect request only")
		},
	}

	err = service.Download(ctx, DownloadOptions{
		BundleID:          "test.download",
		Email:             email,
		OutputDir:         t.TempDir(),
		ExternalVersionID: "812345678",
	}, nil)
	if err == nil {
		t.Fatal("expected the download failure to be reported")
	}
	if len(requested) == 0 {
		t.Fatal("download was never attempted")
	}
	for _, versionID := range requested {
		if versionID != "812345678" {
			t.Fatalf("every attempt must pin the requested build, saw %q in %v", versionID, requested)
		}
	}
}

func TestDownloadFallsBackToCatalogItemID(t *testing.T) {
	ctx := context.Background()
	email := "download@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	account, err := json.Marshal(appstore.Account{
		Email:               email,
		PasswordToken:       "test-token",
		DirectoryServicesID: "test-dsid",
		StoreFront:          "143441-1,29",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.keychain.Set(service.getAccountKey(email), account); err != nil {
		t.Fatal(err)
	}

	var downloadedAppID int64
	service.appStore = &downloadTestAppStore{
		lookup: func(input appstore.LookupInput) (appstore.LookupOutput, error) {
			return appstore.LookupOutput{}, errors.New("app not found")
		},
		download: func(input appstore.DownloadInput) (appstore.DownloadOutput, error) {
			downloadedAppID = input.App.ID
			return appstore.DownloadOutput{}, errors.New("inspect request only")
		},
	}

	err = service.Download(ctx, DownloadOptions{
		BundleID:    "delisted.download",
		Email:       email,
		OutputDir:   t.TempDir(),
		StoreItemID: 424242,
	}, nil)
	if err == nil {
		t.Fatal("expected the download failure to be reported")
	}
	if downloadedAppID != 424242 {
		t.Fatalf("expected the catalog item id to be used, got %d", downloadedAppID)
	}
}

func TestDownloadPinnedBuildDoesNotAcquireLicense(t *testing.T) {
	ctx := context.Background()
	email := "download@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	account, err := json.Marshal(appstore.Account{
		Email:               email,
		PasswordToken:       "test-token",
		DirectoryServicesID: "test-dsid",
		StoreFront:          "143441-1,29",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.keychain.Set(service.getAccountKey(email), account); err != nil {
		t.Fatal(err)
	}

	purchased := false
	service.appStore = &downloadTestAppStore{
		lookup: func(input appstore.LookupInput) (appstore.LookupOutput, error) {
			return appstore.LookupOutput{App: appstore.App{BundleID: input.BundleID}}, nil
		},
		download: func(input appstore.DownloadInput) (appstore.DownloadOutput, error) {
			return appstore.DownloadOutput{}, appstore.ErrLicenseRequired
		},
		purchase: func(appstore.PurchaseInput) error {
			purchased = true
			return nil
		},
	}

	err = service.Download(ctx, DownloadOptions{
		BundleID:          "installed.download",
		Email:             email,
		OutputDir:         t.TempDir(),
		ExternalVersionID: "812345678",
	}, nil)
	if !errors.Is(err, ErrNotOwnedByAccount) {
		t.Fatalf("expected the not-owned error, got %v", err)
	}
	if purchased {
		t.Fatal("a pinned build must not trigger a license purchase")
	}
}

func TestDownloadLatestStillAcquiresLicense(t *testing.T) {
	ctx := context.Background()
	email := "download@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	account, err := json.Marshal(appstore.Account{
		Email:               email,
		PasswordToken:       "test-token",
		DirectoryServicesID: "test-dsid",
		StoreFront:          "143441-1,29",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.keychain.Set(service.getAccountKey(email), account); err != nil {
		t.Fatal(err)
	}

	purchased := false
	attempts := 0
	service.appStore = &downloadTestAppStore{
		lookup: func(input appstore.LookupInput) (appstore.LookupOutput, error) {
			return appstore.LookupOutput{App: appstore.App{BundleID: input.BundleID}}, nil
		},
		download: func(input appstore.DownloadInput) (appstore.DownloadOutput, error) {
			attempts++
			if attempts == 1 {
				return appstore.DownloadOutput{}, appstore.ErrLicenseRequired
			}
			return appstore.DownloadOutput{DestinationPath: input.OutputPath}, nil
		},
		purchase: func(appstore.PurchaseInput) error {
			purchased = true
			return nil
		},
	}

	if err := service.Download(ctx, DownloadOptions{
		BundleID:  "new.download",
		Email:     email,
		OutputDir: t.TempDir(),
	}, nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !purchased {
		t.Fatal("downloading an app for the first time must still acquire the license")
	}
}

func TestDownloadFailsWithoutCatalogItemIDFallback(t *testing.T) {	ctx := context.Background()
	email := "download@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	account, err := json.Marshal(appstore.Account{
		Email:               email,
		PasswordToken:       "test-token",
		DirectoryServicesID: "test-dsid",
		StoreFront:          "143441-1,29",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.keychain.Set(service.getAccountKey(email), account); err != nil {
		t.Fatal(err)
	}

	attempted := false
	service.appStore = &downloadTestAppStore{
		lookup: func(input appstore.LookupInput) (appstore.LookupOutput, error) {
			return appstore.LookupOutput{}, errors.New("app not found")
		},
		download: func(input appstore.DownloadInput) (appstore.DownloadOutput, error) {
			attempted = true
			return appstore.DownloadOutput{}, nil
		},
	}

	err = service.Download(ctx, DownloadOptions{
		BundleID:  "missing.download",
		Email:     email,
		OutputDir: t.TempDir(),
	}, nil)
	if err == nil {
		t.Fatal("expected the lookup failure to be reported")
	}
	if attempted {
		t.Fatal("download must not be attempted without an app identity")
	}
}
