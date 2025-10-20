package cgbipng

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash"
	"io"
)

// Chunk represents a PNG chunk
type Chunk struct {
	Length uint32
	CType  string
	Data   []byte
	Crc32  uint32
	crc    hash.Hash32
}

// Populate reads bytes from the reader and populates a chunk.
func (c *Chunk) Populate(r io.Reader) error {
	buf := make([]byte, 4)
	
	// Read chunk length
	if _, err := io.ReadFull(r, buf); err != nil {
		return err
	}
	c.Length = binary.BigEndian.Uint32(buf)

	// Read chunk type
	if _, err := io.ReadFull(r, buf); err != nil {
		return err
	}
	c.CType = string(buf)
	c.crc.Reset()
	c.crc.Write(buf)

	// Read chunk data
	tmp := make([]byte, c.Length)
	if _, err := io.ReadFull(r, tmp); err != nil {
		return err
	}
	c.Data = tmp
	c.crc.Write(c.Data)
	
	// Read CRC32
	if _, err := io.ReadFull(r, buf); err != nil {
		return err
	}
	c.Crc32 = binary.BigEndian.Uint32(buf)
	sum32 := c.crc.Sum32()
	if c.Crc32 != sum32 {
		return errors.New(fmt.Sprintf("invalid checksum CType:%v", c.CType))
	}
	return nil
}

