package cgbipng

import (
	"hash/crc32"
	"io"
)

// Decode reads a PNG image from r and returns it as an IpaPNG.
func Decode(r io.ReadSeeker) (*IpaPNG, error) {
	cgbi := &IpaPNG{
		r:    r,
		crc:  crc32.NewIEEE(),
		IDAT: []byte{120, 156}, // default zlib header
	}
	if err := cgbi.checkHeader(); err != nil {
		if err == io.EOF {
			err = io.ErrUnexpectedEOF
		}
		return nil, err
	}
	
	stage := dsStart
	for stage != dsSeenIEND {
		c := Chunk{
			crc: crc32.NewIEEE(),
		}
		err := (&c).Populate(cgbi.r)
		if err != nil {
			return nil, err
		}
		if c.CType != "" {
			cgbi.chunks = append(cgbi.chunks, &c)
		}
		stage = c.CType
	}

	err := cgbi.parseChunk()
	if err != nil {
		return nil, err
	}
	return cgbi, nil
}

