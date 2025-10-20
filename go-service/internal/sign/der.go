package sign

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"sort"
)

func EncodeDER(data interface{}) ([]byte, error) {
	switch v := data.(type) {
	case bool:
		return encodeDERBool(v), nil
	case int, int32, int64, uint, uint32, uint64:
		return encodeDERInt(v), nil
	case string:
		return encodeDERString(v), nil
	case []interface{}:
		return encodeDERArray(v)
	case map[string]interface{}:
		return encodeDERDict(v)
	default:
		return nil, fmt.Errorf("unsupported type for DER encoding: %T", v)
	}
}

func encodeDERBool(val bool) []byte {
	if val {
		return []byte{0x01, 0x01, 0x01}
	}
	return []byte{0x01, 0x01, 0x00}
}

func encodeDERInt(val interface{}) []byte {
	var intVal int64
	switch v := val.(type) {
	case int:
		intVal = int64(v)
	case int32:
		intVal = int64(v)
	case int64:
		intVal = v
	case uint:
		intVal = int64(v)
	case uint32:
		intVal = int64(v)
	case uint64:
		intVal = int64(v)
	}

	if intVal == 0 {
		return []byte{0x02, 0x01, 0x00}
	}

	bytes := make([]byte, 0, 9)
	tempVal := intVal
	if tempVal < 0 {
		tempVal = -tempVal
	}

	for tempVal > 0 {
		bytes = append([]byte{byte(tempVal & 0xff)}, bytes...)
		tempVal >>= 8
	}

	if intVal > 0 && bytes[0]&0x80 != 0 {
		bytes = append([]byte{0x00}, bytes...)
	}

	result := []byte{0x02}
	result = append(result, encodeDERLength(len(bytes))...)
	result = append(result, bytes...)
	return result
}

func encodeDERString(val string) []byte {
	result := []byte{0x0c}
	result = append(result, encodeDERLength(len(val))...)
	result = append(result, []byte(val)...)
	return result
}

func encodeDERArray(arr []interface{}) ([]byte, error) {
	content := []byte{}
	for _, item := range arr {
		encoded, err := EncodeDER(item)
		if err != nil {
			return nil, err
		}
		content = append(content, encoded...)
	}

	result := []byte{0x30}
	result = append(result, encodeDERLength(len(content))...)
	result = append(result, content...)
	return result, nil
}

func encodeDERDict(dict map[string]interface{}) ([]byte, error) {
	keys := make([]string, 0, len(dict))
	for key := range dict {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	content := []byte{}
	for _, key := range keys {
		val := dict[key]

		encodedVal, err := EncodeDER(val)
		if err != nil {
			return nil, err
		}

		keyBytes := []byte{0x0c}
		keyBytes = append(keyBytes, encodeDERLength(len(key))...)
		keyBytes = append(keyBytes, []byte(key)...)

		pairContent := append(keyBytes, encodedVal...)

		pair := []byte{0x30}
		pair = append(pair, encodeDERLength(len(pairContent))...)
		pair = append(pair, pairContent...)

		content = append(content, pair...)
	}

	result := []byte{0x31}
	result = append(result, encodeDERLength(len(content))...)
	result = append(result, content...)
	return result, nil
}

func encodeDERLength(length int) []byte {
	if length < 128 {
		return []byte{byte(length)}
	}

	lenBytes := make([]byte, 0, 4)
	tempLen := length
	for tempLen > 0 {
		lenBytes = append([]byte{byte(tempLen & 0xff)}, lenBytes...)
		tempLen >>= 8
	}

	result := []byte{byte(0x80 | len(lenBytes))}
	result = append(result, lenBytes...)
	return result
}

func BuildEntitlementsBlob(entitlements map[string]interface{}) ([]byte, error) {
	plistData, err := encodePlist(entitlements)
	if err != nil {
		return nil, err
	}

	blob := make([]byte, 8)
	binary.BigEndian.PutUint32(blob[0:4], CSMAGIC_EMBEDDED_ENTITLEMENTS)
	binary.BigEndian.PutUint32(blob[4:8], uint32(len(plistData)+8))
	blob = append(blob, plistData...)

	return blob, nil
}

func BuildDEREntitlementsBlob(entitlements map[string]interface{}) ([]byte, error) {
	if len(entitlements) == 0 {
		return nil, nil
	}

	derData, err := EncodeDER(entitlements)
	if err != nil {
		return nil, err
	}

	blob := make([]byte, 8)
	binary.BigEndian.PutUint32(blob[0:4], CSMAGIC_EMBEDDED_DER_ENTITLEMENTS)
	binary.BigEndian.PutUint32(blob[4:8], uint32(len(derData)+8))
	blob = append(blob, derData...)

	return blob, nil
}

func encodePlist(data map[string]interface{}) ([]byte, error) {
	buf := &bytes.Buffer{}
	buf.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
	buf.WriteString("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n")
	buf.WriteString("<plist version=\"1.0\">\n")

	if err := encodePlistDict(buf, data, 0); err != nil {
		return nil, err
	}

	buf.WriteString("</plist>\n")
	return buf.Bytes(), nil
}

func encodePlistDict(buf *bytes.Buffer, dict map[string]interface{}, indent int) error {
	indentStr := ""
	for i := 0; i < indent; i++ {
		indentStr += "\t"
	}

	buf.WriteString(indentStr + "<dict>\n")

	keys := make([]string, 0, len(dict))
	for k := range dict {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		val := dict[key]
		buf.WriteString(indentStr + "\t<key>" + key + "</key>\n")
		if err := encodePlistValue(buf, val, indent+1); err != nil {
			return err
		}
	}

	buf.WriteString(indentStr + "</dict>\n")
	return nil
}

func encodePlistValue(buf *bytes.Buffer, val interface{}, indent int) error {
	indentStr := ""
	for i := 0; i < indent; i++ {
		indentStr += "\t"
	}

	switch v := val.(type) {
	case bool:
		if v {
			buf.WriteString(indentStr + "<true/>\n")
		} else {
			buf.WriteString(indentStr + "<false/>\n")
		}
	case string:
		buf.WriteString(indentStr + "<string>" + v + "</string>\n")
	case int, int32, int64, uint, uint32, uint64:
		buf.WriteString(fmt.Sprintf("%s<integer>%v</integer>\n", indentStr, v))
	case []interface{}:
		buf.WriteString(indentStr + "<array>\n")
		for _, item := range v {
			if err := encodePlistValue(buf, item, indent+1); err != nil {
				return err
			}
		}
		buf.WriteString(indentStr + "</array>\n")
	case map[string]interface{}:
		return encodePlistDict(buf, v, indent)
	default:
		return fmt.Errorf("unsupported plist type: %T", v)
	}
	return nil
}
