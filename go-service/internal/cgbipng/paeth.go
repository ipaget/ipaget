package cgbipng

// intSize is either 32 or 64
const intSize = 32 << (^uint(0) >> 63)

func abs(x int) int {
	m := x >> (intSize - 1)
	return (x ^ m) - m
}

// filterPaeth applies the Paeth filter to the cdat slice.
func filterPaeth(cdat, pdat []byte, bytesPerPixel int) {
	var a, b, c, pa, pb, pc int
	for i := 0; i < bytesPerPixel; i++ {
		a, c = 0, 0
		for j := i; j < len(cdat); j += bytesPerPixel {
			b = int(pdat[j])
			pa = b - c
			pb = a - c
			pc = abs(pa + pb)
			pa = abs(pa)
			pb = abs(pb)
			if pa <= pb && pa <= pc {
				// No-op
			} else if pb <= pc {
				a = b
			} else {
				a = c
			}
			a += int(cdat[j])
			a &= 0xff
			cdat[j] = uint8(a)
			c = b
		}
	}
}

