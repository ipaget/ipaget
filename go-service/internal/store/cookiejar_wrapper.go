package store

import (
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

type CookieJarWrapper struct {
	jar      http.CookieJar
	saver    interface{ Save() error }
	mu       sync.Mutex
	maxRetry int
	retryDelay time.Duration
}

func NewCookieJarWrapper(jar http.CookieJar, maxRetry int, retryDelay time.Duration) *CookieJarWrapper {
	saver, _ := jar.(interface{ Save() error })
	return &CookieJarWrapper{
		jar:        jar,
		saver:      saver,
		maxRetry:   maxRetry,
		retryDelay: retryDelay,
	}
}

func (w *CookieJarWrapper) SetCookies(u *url.URL, cookies []*http.Cookie) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.jar.SetCookies(u, cookies)
}

func (w *CookieJarWrapper) Cookies(u *url.URL) []*http.Cookie {
	return w.jar.Cookies(u)
}

func (w *CookieJarWrapper) Save() error {
	if w.saver == nil {
		return nil
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	var lastErr error
	for i := 0; i < w.maxRetry; i++ {
		err := w.saver.Save()
		if err == nil {
			return nil
		}
		
		lastErr = err
		log.Warn().
			Err(err).
			Int("attempt", i+1).
			Int("max_retry", w.maxRetry).
			Msg("Failed to save cookies, retrying...")
		
		if i < w.maxRetry-1 {
			time.Sleep(w.retryDelay)
		}
	}
	
	return fmt.Errorf("failed to save cookies after %d attempts: %w", w.maxRetry, lastErr)
}
