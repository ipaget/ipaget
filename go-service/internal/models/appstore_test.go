package models

import "testing"

func TestNormalizeStoreVersionID(t *testing.T) {
	cases := []struct {
		name  string
		value interface{}
		want  string
	}{
		{name: "decimal string", value: "812345678", want: "812345678"},
		{name: "padded string", value: "  812345678  ", want: "812345678"},
		{name: "unsigned integer", value: uint64(812345678), want: "812345678"},
		{name: "signed integer", value: int64(812345678), want: "812345678"},
		{name: "float from plist", value: float64(812345678), want: "812345678"},
		{name: "zero integer", value: uint64(0), want: ""},
		{name: "negative integer", value: int64(-1), want: ""},
		{name: "empty string", value: "", want: ""},
		{name: "missing value", value: nil, want: ""},
		{name: "unsupported type", value: []byte{1, 2, 3}, want: ""},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := NormalizeStoreVersionID(testCase.value); got != testCase.want {
				t.Fatalf("NormalizeStoreVersionID(%v) = %q, want %q", testCase.value, got, testCase.want)
			}
		})
	}
}
