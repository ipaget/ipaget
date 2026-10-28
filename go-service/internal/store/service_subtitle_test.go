package store

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestFetchAppStoreSubtitleUsesConfiguredClient(t *testing.T) {
	originalTransport := http.DefaultTransport
	originalClient := appSubtitleHTTPClient
	t.Cleanup(func() {
		http.DefaultTransport = originalTransport
		appSubtitleHTTPClient = originalClient
	})
	http.DefaultTransport = anisetteFixtureTransport(func(request *http.Request) (*http.Response, error) {
		return nil, errors.New("subtitle lookup bypassed the configured client")
	})

	var hosts []string
	appSubtitleHTTPClient = &http.Client{
		Timeout: appSubtitleFetchTimeout,
		Transport: anisetteFixtureTransport(func(request *http.Request) (*http.Response, error) {
			hosts = append(hosts, request.URL.Host)
			if !strings.HasPrefix(request.UserAgent(), "Mozilla/") {
				t.Errorf("request to %s has no browser user agent", request.URL.Host)
			}
			body := `{"results":[{"trackId":284882215}]}`
			if request.URL.Host == "apps.apple.com" {
				body = `<p class="subtitle svelte-kps97o">Connection starts here</p><span class="subtitle">Wrong recommendation</span>`
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
				Request:    request,
			}, nil
		}),
	}

	subtitle, err := fetchAppStoreSubtitle("com.facebook.Facebook", "us")
	if err != nil {
		t.Fatalf("subtitle lookup failed: %v", err)
	}
	if subtitle != "Connection starts here" {
		t.Fatalf("got subtitle %q, want the target app subtitle", subtitle)
	}
	if strings.Join(hosts, ",") != "itunes.apple.com,apps.apple.com" {
		t.Fatalf("unexpected subtitle request chain: %v", hosts)
	}
}

func TestFetchAppStoreSubtitleStructuredResponse(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		country    string
		storefront string
		body       string
		finalPath  string
		want       string
		wantError  bool
	}{
		{
			name: "target app only", country: "us", storefront: "143441-1,29",
			body: `{"storePlatformData":{"product-dv":{"meta":{"storefront":{"cc":"US"}},"results":{"123":{"subtitle":"Wrong recommendation"},"284882215":{"subtitle":"Friends \u0026 family"}}}}}`,
			want: "Friends & family",
		},
		{
			name: "selected region", country: "GB", storefront: "143444-2,29",
			body: `{"storePlatformData":{"product-dv":{"meta":{"storefront":{"cc":"GB"}},"results":{"284882215":{"subtitle":"Connection starts here"}}}}}`,
			want: "Connection starts here",
		},
		{
			name: "missing target", country: "us", storefront: "143441-1,29",
			body: `{"storePlatformData":{"product-dv":{"results":{"123":{"subtitle":"Wrong recommendation"}}}}}`,
			wantError: true,
		},
		{
			name: "different region", country: "us", storefront: "143441-1,29",
			body: `{"storePlatformData":{"product-dv":{"meta":{"storefront":{"cc":"CN"}},"results":{"284882215":{"subtitle":"Wrong region"}}}}}`,
			wantError: true,
		},
		{
			name: "empty subtitle", country: "us", storefront: "143441-1,29",
			body: `{"storePlatformData":{"product-dv":{"results":{"284882215":{"subtitle":""}}}}}`,
		},
		{
			name: "redirected homepage", country: "us", storefront: "143441-1,29",
			body: `<p class="subtitle">Wrong homepage text</p>`, finalPath: "/cn/iphone/today",
			wantError: true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			originalClient := appSubtitleHTTPClient
			t.Cleanup(func() { appSubtitleHTTPClient = originalClient })
			appSubtitleHTTPClient = &http.Client{
				Timeout: appSubtitleFetchTimeout,
				Transport: anisetteFixtureTransport(func(request *http.Request) (*http.Response, error) {
					body := `{"results":[{"trackId":284882215}]}`
					if request.URL.Host == "apps.apple.com" {
						if got := request.Header.Get("X-Apple-Store-Front"); got != testCase.storefront {
							t.Errorf("storefront = %q, want %q", got, testCase.storefront)
						}
						body = testCase.body
						if testCase.finalPath != "" {
							request.URL.Path = testCase.finalPath
							}
					}
					return &http.Response{
						StatusCode: http.StatusOK,
						Header:     make(http.Header),
						Body:       io.NopCloser(strings.NewReader(body)),
						Request:    request,
					}, nil
				}),
			}

			subtitle, err := fetchAppStoreSubtitle("com.facebook.Facebook", testCase.country)
			if (err != nil) != testCase.wantError {
				t.Fatalf("error = %v, wantError = %v", err, testCase.wantError)
			}
			if subtitle != testCase.want {
				t.Fatalf("subtitle = %q, want %q", subtitle, testCase.want)
			}
		})
	}
}