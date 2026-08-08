package device

import "testing"

func TestParseStorageInfoUsesDataVolumeForDisplay(t *testing.T) {
	const (
		totalDisk       = uint64(256000000000)
		totalData       = uint64(247107719168)
		availableOnData = uint64(5550000000)
	)

	info := parseStorageInfo(map[string]interface{}{
		"TotalDiskCapacity":   totalDisk,
		"TotalDataCapacity":   totalData,
		"AmountDataAvailable": availableOnData,
		"AmountDataReserved":  uint64(209715200),
	}, nil)

	if info.UsedSpace != totalData-availableOnData {
		t.Fatalf("used space = %d, want %d", info.UsedSpace, totalData-availableOnData)
	}
	if info.FormattedTotal != "247.11 GB" {
		t.Fatalf("formatted total = %q, want %q", info.FormattedTotal, "247.11 GB")
	}
	if info.FormattedAvailable != "5.55 GB" {
		t.Fatalf("formatted available = %q, want %q", info.FormattedAvailable, "5.55 GB")
	}
}

func TestParseStorageInfoUsesLegacyAvailableWhenAmountIsMissing(t *testing.T) {
	info := parseStorageInfo(map[string]interface{}{
		"TotalDataCapacity":  totalDataCapacityForTest,
		"TotalDataAvailable": uint64(12000000000),
	}, nil)

	if info.FormattedAvailable != "12.00 GB" {
		t.Fatalf("formatted available = %q, want %q", info.FormattedAvailable, "12.00 GB")
	}
}

const totalDataCapacityForTest = uint64(100000000000)
