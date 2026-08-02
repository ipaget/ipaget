package store

import (
	"bytes"
	"crypto/rand"
	"errors"
	"math/big"
)

// SRPClient represents an SRP client
type SRPClient struct {
	Params     *SRPParams
	Secret1    *big.Int
	Multiplier *big.Int
	A          *big.Int
	X          *big.Int
	M1         []byte
	M2         []byte
	K          []byte
	u          *big.Int
	s          *big.Int
}

// NewSRPClient creates a new SRP client
func NewSRPClient(param *SRPParams, a []byte) *SRPClient {
	if len(a) == 0 {
		a = make([]byte, 32)
		rand.Read(a)
	}
	sec := a
	multiplier := param.getMultiplier()
	secret1Int := intFromBytes(sec)
	Ab := param.calculateA(secret1Int)
	A := intFromBytes(Ab)
	return &SRPClient{
		Params:     param,
		Multiplier: multiplier,
		Secret1:    secret1Int,
		A:          A,
	}
}

// ProcessClientChallenge computes K and M1 from username, password, salt, and B
func (c *SRPClient) ProcessClientChallenge(username, password, salt, B []byte) {
	c.X = c.Params.calculateX(salt, username, password)
	bigB := intFromBytes(B)
	u := c.Params.calculateU(c.A, bigB)
	k := c.Multiplier
	S := c.Params.calculateS(k, c.X, c.Secret1, bigB, u)
	c.K = c.Params.calculateK(S)
	c.u = u
	c.s = intFromBytes(S)
	A := padToN(c.A, c.Params)
	c.M1 = c.Params.calculateM1(username, salt, A, B, c.K)
	c.M2 = c.Params.calculateM2(A, c.M1, c.K)
}

// GetABytes returns A as bytes
func (c *SRPClient) GetABytes() []byte {
	return padToN(c.A, c.Params)
}

// GetM1Bytes returns M1 as bytes
func (c *SRPClient) GetM1Bytes() []byte {
	return c.M1
}

// GetSessionKey returns the session key K
func (c *SRPClient) GetSessionKey() []byte {
	return c.K
}

// CheckM2 verifies the server's M2
func (c *SRPClient) CheckM2(M2 []byte) error {
	if !bytes.Equal(c.M2, M2) {
		return errors.New("M2 didn't check")
	}
	return nil
}

