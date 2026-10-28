package plistutil

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"sort"
	"strings"
	"time"

	"howett.net/plist"
)

// Service provides parse/write helpers for standalone property list files.
type Service struct{}

func NewService() *Service {
	return &Service{}
}

// ParseResult is the JSON-friendly representation returned to the frontend.
type ParseResult struct {
	Format     string      `json:"format"`
	FormatCode int         `json:"format_code"`
	Root       interface{} `json:"root"`
	XMLPreview string      `json:"xml_preview,omitempty"`
}

// WriteRequest describes how to serialize a property list back to disk.
type WriteRequest struct {
	Path   string
	Root   interface{}
	Format string // "xml", "binary", or "preserve"
}

func formatName(formatCode int) string {
	switch formatCode {
	case plist.XMLFormat:
		return "xml"
	case plist.BinaryFormat:
		return "binary"
	case plist.OpenStepFormat:
		return "openstep"
	case plist.GNUStepFormat:
		return "gnustep"
	default:
		return "unknown"
	}
}

func resolveFormat(name string, originalFormat int) (int, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "preserve":
		if originalFormat == plist.BinaryFormat {
			return plist.BinaryFormat, nil
		}
		// Default and non-binary formats write as XML for maximum compatibility.
		return plist.XMLFormat, nil
	case "xml":
		return plist.XMLFormat, nil
	case "binary":
		return plist.BinaryFormat, nil
	default:
		return 0, fmt.Errorf("unsupported plist format %q", name)
	}
}

// ParseFile reads a property list from disk and returns a JSON-safe tree.
func (s *Service) ParseFile(path string) (*ParseResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read plist file: %w", err)
	}
	return s.ParseBytes(data)
}

// ParseBytes decodes raw property list bytes.
func (s *Service) ParseBytes(data []byte) (*ParseResult, error) {
	var raw interface{}
	formatCode, err := plist.Unmarshal(data, &raw)
	if err != nil {
		return nil, fmt.Errorf("failed to parse plist: %w", err)
	}

	root, err := encodeNode(raw)
	if err != nil {
		return nil, err
	}

	result := &ParseResult{
		Format:     formatName(formatCode),
		FormatCode: formatCode,
		Root:       root,
	}

	if xmlBytes, marshalErr := plist.MarshalIndent(raw, plist.XMLFormat, "\t"); marshalErr == nil {
		result.XMLPreview = string(xmlBytes)
	}

	return result, nil
}

// WriteFile serializes a JSON-safe tree back to a property list file.
func (s *Service) WriteFile(req WriteRequest) error {
	if strings.TrimSpace(req.Path) == "" {
		return fmt.Errorf("path is required")
	}

	originalFormat := plist.XMLFormat
	if existing, err := os.ReadFile(req.Path); err == nil {
		var discard interface{}
		if formatCode, parseErr := plist.Unmarshal(existing, &discard); parseErr == nil {
			originalFormat = formatCode
		}
	}

	formatCode, err := resolveFormat(req.Format, originalFormat)
	if err != nil {
		return err
	}

	nativeRoot, err := decodeNode(req.Root)
	if err != nil {
		return fmt.Errorf("invalid plist tree: %w", err)
	}

	var encoded []byte
	if formatCode == plist.XMLFormat {
		encoded, err = plist.MarshalIndent(nativeRoot, plist.XMLFormat, "\t")
	} else {
		encoded, err = plist.Marshal(nativeRoot, formatCode)
	}
	if err != nil {
		return fmt.Errorf("failed to marshal plist: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(req.Path), 0755); err != nil {
		return fmt.Errorf("failed to create parent directory: %w", err)
	}

	if err := os.WriteFile(req.Path, encoded, 0644); err != nil {
		return fmt.Errorf("failed to write plist file: %w", err)
	}
	return nil
}

// RenderXML converts a tagged JSON tree into indented XML text for preview.
func (s *Service) RenderXML(root interface{}) (string, error) {
	nativeRoot, err := decodeNode(root)
	if err != nil {
		return "", fmt.Errorf("invalid plist tree: %w", err)
	}

	encoded, err := plist.MarshalIndent(nativeRoot, plist.XMLFormat, "\t")
	if err != nil {
		return "", fmt.Errorf("failed to render plist xml: %w", err)
	}
	return string(encoded), nil
}

// encodeNode converts native plist values into a tagged JSON structure.
func encodeNode(value interface{}) (interface{}, error) {
	switch typed := value.(type) {
	case nil:
		return map[string]interface{}{"type": "null"}, nil
	case bool:
		return map[string]interface{}{"type": "boolean", "value": typed}, nil
	case string:
		return map[string]interface{}{"type": "string", "value": typed}, nil
	case []byte:
		return map[string]interface{}{
			"type":  "data",
			"value": base64.StdEncoding.EncodeToString(typed),
		}, nil
	case time.Time:
		return map[string]interface{}{
			"type":  "date",
			"value": typed.UTC().Format(time.RFC3339Nano),
		}, nil
	case plist.UID:
		return map[string]interface{}{
			"type":  "uid",
			"value": uint64(typed),
		}, nil
	case int:
		return map[string]interface{}{"type": "integer", "value": int64(typed)}, nil
	case int8:
		return map[string]interface{}{"type": "integer", "value": int64(typed)}, nil
	case int16:
		return map[string]interface{}{"type": "integer", "value": int64(typed)}, nil
	case int32:
		return map[string]interface{}{"type": "integer", "value": int64(typed)}, nil
	case int64:
		return map[string]interface{}{"type": "integer", "value": typed}, nil
	case uint:
		return encodeUnsignedInteger(uint64(typed))
	case uint8:
		return encodeUnsignedInteger(uint64(typed))
	case uint16:
		return encodeUnsignedInteger(uint64(typed))
	case uint32:
		return encodeUnsignedInteger(uint64(typed))
	case uint64:
		return encodeUnsignedInteger(typed)
	case float32:
		return map[string]interface{}{"type": "real", "value": float64(typed)}, nil
	case float64:
		return map[string]interface{}{"type": "real", "value": typed}, nil
	case map[string]interface{}:
		entries := make([]map[string]interface{}, 0, len(typed))
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			child := typed[key]
			encodedChild, err := encodeNode(child)
			if err != nil {
				return nil, err
			}
			entries = append(entries, map[string]interface{}{
				"key":   key,
				"value": encodedChild,
			})
		}
		return map[string]interface{}{
			"type":    "dict",
			"entries": entries,
		}, nil
	case []interface{}:
		items := make([]interface{}, 0, len(typed))
		for _, child := range typed {
			encodedChild, err := encodeNode(child)
			if err != nil {
				return nil, err
			}
			items = append(items, encodedChild)
		}
		return map[string]interface{}{
			"type":  "array",
			"items": items,
		}, nil
	default:
		// Fallback for unexpected concrete map/slice types via JSON round-trip.
		rawJSON, err := json.Marshal(value)
		if err != nil {
			return nil, fmt.Errorf("unsupported plist value type %T", value)
		}
		var generic interface{}
		if err := json.Unmarshal(rawJSON, &generic); err != nil {
			return nil, fmt.Errorf("unsupported plist value type %T", value)
		}
		return encodeNode(generic)
	}
}

func encodeUnsignedInteger(value uint64) (map[string]interface{}, error) {
	if value > math.MaxInt64 {
		return map[string]interface{}{
			"type":  "integer",
			"value": strconv.FormatUint(value, 10),
		}, nil
	}
	return map[string]interface{}{
		"type":  "integer",
		"value": int64(value),
	}, nil
}

// decodeNode converts a tagged JSON structure back into native plist values.
func decodeNode(value interface{}) (interface{}, error) {
	nodeMap, ok := value.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("expected object node, got %T", value)
	}

	nodeType, _ := nodeMap["type"].(string)
	switch nodeType {
	case "null":
		return nil, nil
	case "boolean":
		boolValue, ok := nodeMap["value"].(bool)
		if !ok {
			return nil, fmt.Errorf("boolean node requires boolean value")
		}
		return boolValue, nil
	case "string":
		stringValue, ok := nodeMap["value"].(string)
		if !ok {
			return nil, fmt.Errorf("string node requires string value")
		}
		return stringValue, nil
	case "integer":
		return decodeInteger(nodeMap["value"])
	case "real":
		switch typed := nodeMap["value"].(type) {
		case float64:
			return typed, nil
		case json.Number:
			return typed.Float64()
		case string:
			return strconv.ParseFloat(typed, 64)
		default:
			return nil, fmt.Errorf("real node requires numeric value")
		}
	case "data":
		stringValue, ok := nodeMap["value"].(string)
		if !ok {
			return nil, fmt.Errorf("data node requires base64 string value")
		}
		decoded, err := base64.StdEncoding.DecodeString(stringValue)
		if err != nil {
			return nil, fmt.Errorf("invalid data base64: %w", err)
		}
		return decoded, nil
	case "date":
		stringValue, ok := nodeMap["value"].(string)
		if !ok {
			return nil, fmt.Errorf("date node requires string value")
		}
		parsed, err := time.Parse(time.RFC3339Nano, stringValue)
		if err != nil {
			parsed, err = time.Parse(time.RFC3339, stringValue)
			if err != nil {
				return nil, fmt.Errorf("invalid date value: %w", err)
			}
		}
		return parsed.UTC(), nil
	case "uid":
		integerValue, err := decodeInteger(nodeMap["value"])
		if err != nil {
			return nil, err
		}
		switch typed := integerValue.(type) {
		case int64:
			if typed < 0 {
				return nil, fmt.Errorf("uid cannot be negative")
			}
			return plist.UID(typed), nil
		case uint64:
			return plist.UID(typed), nil
		default:
			return nil, fmt.Errorf("invalid uid value")
		}
	case "dict":
		entries, err := asInterfaceSlice(nodeMap["entries"])
		if err != nil {
			if nodeMap["entries"] == nil {
				return map[string]interface{}{}, nil
			}
			return nil, fmt.Errorf("dict node requires entries array")
		}
		result := make(map[string]interface{}, len(entries))
		for index, entryRaw := range entries {
			entry, ok := entryRaw.(map[string]interface{})
			if !ok {
				return nil, fmt.Errorf("dict entry %d is invalid", index)
			}
			key, ok := entry["key"].(string)
			if !ok {
				return nil, fmt.Errorf("dict entry %d is missing key", index)
			}
			child, err := decodeNode(entry["value"])
			if err != nil {
				return nil, fmt.Errorf("dict key %q: %w", key, err)
			}
			result[key] = child
		}
		return result, nil
	case "array":
		items, err := asInterfaceSlice(nodeMap["items"])
		if err != nil {
			if nodeMap["items"] == nil {
				return []interface{}{}, nil
			}
			return nil, fmt.Errorf("array node requires items array")
		}
		result := make([]interface{}, 0, len(items))
		for index, item := range items {
			child, err := decodeNode(item)
			if err != nil {
				return nil, fmt.Errorf("array index %d: %w", index, err)
			}
			result = append(result, child)
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unknown plist node type %q", nodeType)
	}
}

func decodeInteger(value interface{}) (interface{}, error) {
	switch typed := value.(type) {
	case float64:
		if typed != math.Trunc(typed) {
			return nil, fmt.Errorf("integer node has fractional value")
		}
		return int64(typed), nil
	case json.Number:
		if intValue, err := typed.Int64(); err == nil {
			return intValue, nil
		}
		uintValue, err := strconv.ParseUint(string(typed), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid integer value")
		}
		return uintValue, nil
	case string:
		if intValue, err := strconv.ParseInt(typed, 10, 64); err == nil {
			return intValue, nil
		}
		uintValue, err := strconv.ParseUint(typed, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid integer value")
		}
		return uintValue, nil
	case int:
		return int64(typed), nil
	case int64:
		return typed, nil
	case uint64:
		return typed, nil
	default:
		return nil, fmt.Errorf("integer node requires numeric value")
	}
}

func asInterfaceSlice(value interface{}) ([]interface{}, error) {
	switch typed := value.(type) {
	case nil:
		return nil, fmt.Errorf("missing slice")
	case []interface{}:
		return typed, nil
	case []map[string]interface{}:
		result := make([]interface{}, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result, nil
	default:
		// Accept other slice-like values produced before JSON normalization.
		rawJSON, err := json.Marshal(value)
		if err != nil {
			return nil, fmt.Errorf("expected array, got %T", value)
		}
		var result []interface{}
		if err := json.Unmarshal(rawJSON, &result); err != nil {
			return nil, fmt.Errorf("expected array, got %T", value)
		}
		return result, nil
	}
}
