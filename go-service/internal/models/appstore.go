package models

import (
	"strconv"
	"strings"
)

// NormalizeStoreVersionID converts an App Store external version identifier into
// its canonical decimal string. Apple records the identifier as an integer in
// iTunesMetadata while the frontend carries it as a string, so both forms have
// to be accepted before the value can be compared or sent back to the store.
func NormalizeStoreVersionID(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case uint64:
		return formatStoreVersionID(typed)
	case uint32:
		return formatStoreVersionID(uint64(typed))
	case uint:
		return formatStoreVersionID(uint64(typed))
	case int64:
		if typed > 0 {
			return formatStoreVersionID(uint64(typed))
		}
	case int:
		if typed > 0 {
			return formatStoreVersionID(uint64(typed))
		}
	case float64:
		if typed > 0 {
			return formatStoreVersionID(uint64(typed))
		}
	case float32:
		if typed > 0 {
			return formatStoreVersionID(uint64(typed))
		}
	}
	return ""
}

func formatStoreVersionID(value uint64) string {
	if value == 0 {
		return ""
	}
	return strconv.FormatUint(value, 10)
}
