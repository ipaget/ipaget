package store

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/majd/ipatool/v2/pkg/appstore"
)

type loginCountingAppStore struct {
	appstore.AppStore
	onLogin func(appstore.LoginInput) (appstore.LoginOutput, error)
	calls   int
}

func (client *loginCountingAppStore) Login(input appstore.LoginInput) (appstore.LoginOutput, error) {
	client.calls++
	return client.onLogin(input)
}

func storeTestAccount(t *testing.T, service *Service, account appstore.Account) {
	t.Helper()

	data, err := json.Marshal(account)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.keychain.Set(service.getAccountKey(account.Email), data); err != nil {
		t.Fatal(err)
	}
}

func TestReadOnlyQueryDoesNotRelogin(t *testing.T) {
	email := "readonly@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	storeTestAccount(t, service, appstore.Account{Email: email, Password: "stored-password"})

	appStore := &loginCountingAppStore{onLogin: func(appstore.LoginInput) (appstore.LoginOutput, error) {
		return appstore.LoginOutput{}, errors.New("read-only queries must not sign in")
	}}
	service.appStore = appStore

	if _, err := service.GetCountryCode(email); err == nil {
		t.Fatal("expected the stale session to be reported instead of refreshed")
	}
	if appStore.calls != 0 {
		t.Fatalf("read-only query performed %d login calls, want 0", appStore.calls)
	}
}

func TestDownloadKeepsRefreshingStaleSession(t *testing.T) {
	email := "refresh@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	storeTestAccount(t, service, appstore.Account{Email: email, Password: "stored-password"})

	appStore := &loginCountingAppStore{onLogin: func(input appstore.LoginInput) (appstore.LoginOutput, error) {
		if input.Email != email {
			t.Fatalf("unexpected login email %q", input.Email)
		}
		return appstore.LoginOutput{Account: appstore.Account{
			Email:               email,
			PasswordToken:       "fresh-token",
			DirectoryServicesID: "fresh-dsid",
			StoreFront:          "143441-1,29",
		}}, nil
	}}
	service.appStore = appStore

	account, err := service.getAccount(email)
	if err != nil {
		t.Fatalf("expected the session to be refreshed: %v", err)
	}
	if appStore.calls != 1 {
		t.Fatalf("got %d login calls, want exactly 1 refresh", appStore.calls)
	}
	if !hasUsableAppStoreSession(account) {
		t.Fatalf("refreshed account is still unusable: %+v", account)
	}
}

func TestClearStoredSessionKeepsAccountButDropsSignInData(t *testing.T) {
	email := "clear@example.invalid"
	service := &Service{keychain: authTestKeychain{}}
	storeTestAccount(t, service, appstore.Account{
		Email:               email,
		Password:            "stored-password",
		PasswordToken:       "stored-token",
		DirectoryServicesID: "stored-dsid",
		StoreFront:          "143441-1,29",
	})

	state, err := service.GetLoginSessionState(email)
	if err != nil {
		t.Fatal(err)
	}
	if !state.HasAccount || !state.HasAppStoreSession || !state.HasStoredPassword {
		t.Fatalf("expected a reusable session before clearing: %+v", state)
	}

	if err := service.ClearStoredSession(email); err != nil {
		t.Fatalf("failed to clear the stored session: %v", err)
	}

	state, err = service.GetLoginSessionState(email)
	if err != nil {
		t.Fatal(err)
	}
	if !state.HasAccount {
		t.Fatal("clearing the session must keep the account listed")
	}
	if state.HasAppStoreSession || state.HasStoredPassword || state.HasGSACredentials {
		t.Fatalf("cleared account still reports stored sign-in data: %+v", state)
	}
}

func TestGetLoginSessionStateForUnknownAccount(t *testing.T) {
	service := &Service{keychain: authTestKeychain{}}

	state, err := service.GetLoginSessionState("missing@example.invalid")
	if err != nil {
		t.Fatalf("an unknown account must be reported, not returned as an error: %v", err)
	}
	if state.HasAccount || state.HasAppStoreSession {
		t.Fatalf("unknown account reported stored data: %+v", state)
	}
}
