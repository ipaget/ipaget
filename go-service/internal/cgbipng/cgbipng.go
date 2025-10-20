package cgbipng

import (
	"bytes"
	"image/png"
)

// ConvertToStandardPNG converts CgBI PNG (Apple optimized PNG) to standard PNG format
// that can be displayed in web browsers.
func ConvertToStandardPNG(data []byte) ([]byte, error) {
	r := bytes.NewReader(data)
	
	ipaPng, err := Decode(r)
	if err != nil {
		return nil, err
	}
	
	// If it's already a standard PNG, return as-is
	if !ipaPng.IsCgBI {
		return data, nil
	}
	
	// Convert to standard PNG
	var buf bytes.Buffer
	err = png.Encode(&buf, ipaPng.Img)
	if err != nil {
		return nil, err
	}
	
	return buf.Bytes(), nil
}

