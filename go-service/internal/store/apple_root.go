package store

import (
	"crypto/tls"
	"crypto/x509"
	_ "embed"
)

//go:embed apple_root.pem
var appleRootPEM []byte

func appleTLSConfig() *tls.Config {
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}
	roots.AppendCertsFromPEM(appleRootPEM)
	return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}
}
