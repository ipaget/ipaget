package store

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"errors"
)

var (
	// ErrInvalidBlockSize indicates hash blocksize <= 0.
	ErrInvalidBlockSize = errors.New("invalid blocksize")

	// ErrInvalidPKCS7Data indicates bad input to PKCS7 pad or unpad.
	ErrInvalidPKCS7Data = errors.New("invalid PKCS7 data (empty or not padded)")

	// ErrInvalidPKCS7Padding indicates PKCS7 unpad fails to bad input.
	ErrInvalidPKCS7Padding = errors.New("invalid padding on input")
)

// pkcs7Pad right-pads the given byte slice with 1 to n bytes, where
// n is the block size. The size of the result is x times n, where x
// is at least 1.
func pkcs7Pad(b []byte, blocksize int) ([]byte, error) {
	if blocksize <= 0 {
		return nil, ErrInvalidBlockSize
	}
	if b == nil || len(b) == 0 {
		return nil, ErrInvalidPKCS7Data
	}
	n := blocksize - (len(b) % blocksize)
	pb := make([]byte, len(b)+n)
	copy(pb, b)
	copy(pb[len(b):], bytes.Repeat([]byte{byte(n)}, n))
	return pb, nil
}

// pkcs7Unpad validates and unpads data from the given bytes slice.
// The returned value will be 1 to n bytes smaller depending on the
// amount of padding, where n is the block size.
func pkcs7Unpad(b []byte, blocksize int) ([]byte, error) {
	if blocksize <= 0 {
		return nil, ErrInvalidBlockSize
	}
	if b == nil || len(b) == 0 {
		return nil, ErrInvalidPKCS7Data
	}
	if len(b)%blocksize != 0 {
		return nil, ErrInvalidPKCS7Padding
	}
	c := b[len(b)-1]
	n := int(c)
	if n == 0 || n > len(b) {
		return nil, ErrInvalidPKCS7Padding
	}
	for i := 0; i < n; i++ {
		if b[len(b)-n+i] != c {
			return nil, ErrInvalidPKCS7Padding
		}
	}
	return b[:len(b)-n], nil
}

// DecryptCBC decrypts data using AES-CBC mode
func DecryptCBC(key, iv, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(iv) >= block.BlockSize() {
		iv = iv[:block.BlockSize()]
	} else {
		iv = make([]byte, block.BlockSize())
	}

	plaintext := make([]byte, len(ciphertext))
	bm := cipher.NewCBCDecrypter(block, iv)
	bm.CryptBlocks(plaintext, ciphertext)
	plaintext, err = pkcs7Unpad(plaintext, block.BlockSize())
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

// DecryptGCM decrypts data using Apple's app token envelope format.
// The payload layout matches AltStore's implementation:
// 3 bytes version + 16 bytes IV + ciphertext + 16 bytes authentication tag.
func DecryptGCM(key, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return nil, err
	}

	const (
		versionSize = 3
		ivSize      = 16
		tagSize     = 16
	)

	if len(ciphertext) <= versionSize+ivSize+tagSize {
		return nil, errors.New("ciphertext too short")
	}

	version := ciphertext[:versionSize]
	nonce := ciphertext[versionSize : versionSize+ivSize]
	encrypted := ciphertext[versionSize+ivSize:]

	// Apple's implementation authenticates the version bytes as AAD.
	plaintext, err := gcm.Open(nil, nonce, encrypted, version)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}
