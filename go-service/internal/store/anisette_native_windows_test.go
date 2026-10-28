package store

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestWindowsNativeAnisetteHTTP(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Error(err)
			return
		}
		if request.Method != http.MethodPost || string(body) != `{"test":"fixture"}` || request.Header.Get("Content-Type") != "application/json" {
			t.Error("native metadata request did not preserve its method, body or headers")
		}
		writer.WriteHeader(http.StatusOK)
		writer.Write([]byte(`{"result":"fixture"}`))
	}))
	defer server.Close()
	request, err := http.NewRequest(http.MethodPost, server.URL, strings.NewReader(`{"test":"fixture"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := windowsAnisetteHTTP(request, nil, 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != http.StatusOK || string(data) != `{"result":"fixture"}` {
		t.Fatalf("native metadata response was not preserved: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := windowsAnisetteHTTP(request.Clone(ctx), nil, time.Second); err != context.Canceled {
		t.Fatal("native metadata request must honor cancellation")
	}
}

func TestWindowsNativeAnisetteHonorsProxy(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Host != "native-probe.invalid" {
			t.Error("native request did not preserve its destination")
		}
		writer.Write([]byte("proxy-response"))
	}))
	defer proxy.Close()
	proxyURL, err := url.Parse(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodGet, "http://native-probe.invalid/v3/client_info", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := windowsAnisetteHTTP(request, proxyURL, 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "proxy-response" {
		t.Fatal("native request did not use the selected proxy")
	}
}

func TestWindowsNativeAnisetteCancelsPendingResponse(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) { close(started); <-release }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := windowsAnisetteHTTP(request, nil, 5*time.Second); result <- err }()
	select {
	case <-started:
	case err := <-result:
		close(release)
		t.Fatalf("native request failed before reaching fixture: %v", err)
	case <-time.After(3 * time.Second):
		cancel()
		close(release)
		<-result
		t.Fatal("native request did not reach fixture")
	}
	cancel()
	select {
	case err := <-result:
		close(release)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("native cancellation returned %v", err)
		}
	case <-time.After(2 * time.Second):
		close(release)
		<-result
		t.Fatal("native HTTP did not interrupt a pending response")
	}
}
