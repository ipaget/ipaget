package sign

import (
	"encoding/binary"
	"fmt"
	"os"
)

const (
	MH_MAGIC    = 0xfeedface
	MH_CIGAM    = 0xcefaedfe
	MH_MAGIC_64 = 0xfeedfacf
	MH_CIGAM_64 = 0xcffaedfe

	FAT_MAGIC    = 0xcafebabe
	FAT_CIGAM    = 0xbebafeca
	FAT_MAGIC_64 = 0xcafebabf
	FAT_CIGAM_64 = 0xbfbafeca

	LC_SEGMENT            = 0x1
	LC_SEGMENT_64         = 0x19
	LC_LOAD_DYLIB         = 0x0c
	LC_LOAD_WEAK_DYLIB    = 0x18
	LC_CODE_SIGNATURE     = 0x1d
	LC_ENCRYPTION_INFO    = 0x21
	LC_ENCRYPTION_INFO_64 = 0x2c

	CPU_TYPE_ARM    = 12
	CPU_TYPE_ARM64  = 0x0100000c
	CPU_TYPE_X86    = 7
	CPU_TYPE_X86_64 = 0x01000007
)

type MachOHeader struct {
	Magic      uint32
	CPUType    uint32
	CPUSubType uint32
	FileType   uint32
	NCmds      uint32
	SizeOfCmds uint32
	Flags      uint32
	Reserved   uint32
}

type LoadCommand struct {
	Cmd     uint32
	CmdSize uint32
}

type SegmentCommand struct {
	Cmd      uint32
	CmdSize  uint32
	SegName  [16]byte
	VMAddr   uint64
	VMSize   uint64
	FileOff  uint64
	FileSize uint64
	MaxProt  uint32
	InitProt uint32
	NSects   uint32
	Flags    uint32
}

type CodeSignatureCmd struct {
	Cmd      uint32
	CmdSize  uint32
	DataOff  uint32
	DataSize uint32
}

func ParseMachO(filePath string) (*MachOBinary, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	if len(data) < 4 {
		return nil, fmt.Errorf("file too small to be a Mach-O binary")
	}

	magic := binary.BigEndian.Uint32(data[0:4])

	macho := &MachOBinary{
		Path: filePath,
		Data: data,
	}

	switch magic {
	case FAT_MAGIC, FAT_CIGAM, FAT_MAGIC_64, FAT_CIGAM_64:
		macho.IsFat = true
		return parseFatBinary(data, macho)
	case MH_MAGIC, MH_CIGAM, MH_MAGIC_64, MH_CIGAM_64:
		macho.IsFat = false
		return macho, nil
	default:
		return nil, fmt.Errorf("not a valid Mach-O binary: magic=%x", magic)
	}
}

func parseFatBinary(data []byte, macho *MachOBinary) (*MachOBinary, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("fat binary header too small")
	}

	magic := binary.BigEndian.Uint32(data[0:4])
	nfatArch := binary.BigEndian.Uint32(data[4:8])

	is64 := (magic == FAT_MAGIC_64 || magic == FAT_CIGAM_64)
	archSize := 20
	if is64 {
		archSize = 28
	}

	offset := 8
	for i := uint32(0); i < nfatArch; i++ {
		if len(data) < offset+archSize {
			return nil, fmt.Errorf("fat arch entry too small")
		}

		arch := MachOArch{
			CPUType:    binary.BigEndian.Uint32(data[offset : offset+4]),
			CPUSubType: binary.BigEndian.Uint32(data[offset+4 : offset+8]),
		}

		if is64 {
			arch.Offset = binary.BigEndian.Uint64(data[offset+8 : offset+16])
			arch.Size = binary.BigEndian.Uint64(data[offset+16 : offset+24])
			arch.Align = binary.BigEndian.Uint32(data[offset+24 : offset+28])
		} else {
			arch.Offset = uint64(binary.BigEndian.Uint32(data[offset+8 : offset+12]))
			arch.Size = uint64(binary.BigEndian.Uint32(data[offset+12 : offset+16]))
			arch.Align = binary.BigEndian.Uint32(data[offset+16 : offset+20])
		}

		macho.Architectures = append(macho.Architectures, arch)
		offset += archSize
	}

	return macho, nil
}

func FindCodeSignatureOffset(data []byte, offset uint64) (uint32, uint32, error) {
	if len(data) < int(offset)+28 {
		return 0, 0, fmt.Errorf("data too small for mach-o header")
	}

	magic := binary.LittleEndian.Uint32(data[offset : offset+4])
	is64bit := (magic == MH_MAGIC_64 || magic == MH_CIGAM_64)

	headerSize := 28
	if is64bit {
		headerSize = 32
	}

	if len(data) < int(offset)+headerSize {
		return 0, 0, fmt.Errorf("data too small for full mach-o header")
	}

	ncmds := binary.LittleEndian.Uint32(data[offset+16 : offset+20])
	cmdOffset := offset + uint64(headerSize)

	for i := uint32(0); i < ncmds; i++ {
		if len(data) < int(cmdOffset)+8 {
			return 0, 0, fmt.Errorf("load command header out of bounds")
		}

		cmd := binary.LittleEndian.Uint32(data[cmdOffset : cmdOffset+4])
		cmdSize := binary.LittleEndian.Uint32(data[cmdOffset+4 : cmdOffset+8])

		if cmd == LC_CODE_SIGNATURE {
			if len(data) < int(cmdOffset)+16 {
				return 0, 0, fmt.Errorf("code signature command out of bounds")
			}
			dataOff := binary.LittleEndian.Uint32(data[cmdOffset+8 : cmdOffset+12])
			dataSize := binary.LittleEndian.Uint32(data[cmdOffset+12 : cmdOffset+16])
			return dataOff, dataSize, nil
		}

		cmdOffset += uint64(cmdSize)
	}

	return 0, 0, nil
}

func RemoveCodeSignature(data []byte, offset uint64) ([]byte, error) {
	if len(data) < int(offset)+28 {
		return nil, fmt.Errorf("data too small")
	}

	magic := binary.LittleEndian.Uint32(data[offset : offset+4])
	is64bit := (magic == MH_MAGIC_64 || magic == MH_CIGAM_64)

	headerSize := 28
	if is64bit {
		headerSize = 32
	}

	ncmds := binary.LittleEndian.Uint32(data[offset+16 : offset+20])
	sizeofcmds := binary.LittleEndian.Uint32(data[offset+20 : offset+24])

	result := make([]byte, len(data))
	copy(result, data)

	cmdOffset := offset + uint64(headerSize)
	newCmds := make([]byte, 0, sizeofcmds)

	for i := uint32(0); i < ncmds; i++ {
		if len(result) < int(cmdOffset)+8 {
			break
		}

		cmd := binary.LittleEndian.Uint32(result[cmdOffset : cmdOffset+4])
		cmdSize := binary.LittleEndian.Uint32(result[cmdOffset+4 : cmdOffset+8])

		if cmd != LC_CODE_SIGNATURE {
			newCmds = append(newCmds, result[cmdOffset:cmdOffset+uint64(cmdSize)]...)
		}

		cmdOffset += uint64(cmdSize)
	}

	newNcmds := uint32(len(newCmds)) / 8
	newSizeofcmds := uint32(len(newCmds))

	headerEnd := offset + uint64(headerSize)
	copy(result[headerEnd:], newCmds)

	binary.LittleEndian.PutUint32(result[offset+16:offset+20], newNcmds)
	binary.LittleEndian.PutUint32(result[offset+20:offset+24], newSizeofcmds)

	trimOffset := headerEnd + uint64(newSizeofcmds)
	if csOffset, _, err := FindCodeSignatureOffset(data, offset); err == nil && csOffset > 0 {
		return result[:csOffset], nil
	}

	return result[:trimOffset], nil
}

func InjectDylib(data []byte, dylibPath string, weak bool) ([]byte, error) {
	if len(data) < 4 {
		return nil, fmt.Errorf("invalid Mach-O data")
	}

	magic := binary.LittleEndian.Uint32(data[0:4])

	switch magic {
	case FAT_MAGIC, FAT_CIGAM, FAT_MAGIC_64, FAT_CIGAM_64:
		return injectDylibFat(data, dylibPath, weak)
	case MH_MAGIC, MH_CIGAM, MH_MAGIC_64, MH_CIGAM_64:
		return injectDylibSingle(data, 0, dylibPath, weak)
	default:
		return nil, fmt.Errorf("invalid Mach-O magic: 0x%x", magic)
	}
}

func injectDylibFat(data []byte, dylibPath string, weak bool) ([]byte, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("invalid FAT header")
	}

	nfatArch := binary.BigEndian.Uint32(data[4:8])

	result := make([]byte, len(data))
	copy(result, data)

	fatHeaderSize := 8 + int(nfatArch)*20
	if len(data) < fatHeaderSize {
		return nil, fmt.Errorf("invalid FAT architecture table")
	}

	for i := uint32(0); i < nfatArch; i++ {
		archOffset := 8 + i*20
		offset := binary.BigEndian.Uint32(result[archOffset+8 : archOffset+12])
		size := binary.BigEndian.Uint32(result[archOffset+12 : archOffset+16])

		if uint64(offset)+uint64(size) > uint64(len(result)) {
			continue
		}

		archData := result[offset : offset+size]
		modified, err := injectDylibSingle(archData, 0, dylibPath, weak)
		if err != nil {
			return nil, fmt.Errorf("failed to inject dylib in architecture %d: %v", i, err)
		}

		copy(result[offset:], modified)
	}

	return result, nil
}

func injectDylibSingle(data []byte, offset uint64, dylibPath string, weak bool) ([]byte, error) {
	if uint64(len(data)) < offset+28 {
		return nil, fmt.Errorf("invalid Mach-O header")
	}

	headerOffset := offset
	magic := binary.LittleEndian.Uint32(data[headerOffset : headerOffset+4])

	var headerSize uint64

	switch magic {
	case MH_MAGIC, MH_CIGAM:
		headerSize = 28
	case MH_MAGIC_64, MH_CIGAM_64:
		headerSize = 32
	default:
		return nil, fmt.Errorf("invalid Mach-O magic")
	}

	if uint64(len(data)) < headerOffset+headerSize {
		return nil, fmt.Errorf("invalid header size")
	}

	ncmds := binary.LittleEndian.Uint32(data[headerOffset+16 : headerOffset+20])
	sizeofcmds := binary.LittleEndian.Uint32(data[headerOffset+20 : headerOffset+24])

	// Check if dylib already exists
	cmdOffset := headerOffset + headerSize
	for i := uint32(0); i < ncmds; i++ {
		if uint64(len(data)) < cmdOffset+8 {
			break
		}

		cmd := binary.LittleEndian.Uint32(data[cmdOffset : cmdOffset+4])
		cmdsize := binary.LittleEndian.Uint32(data[cmdOffset+4 : cmdOffset+8])

		if cmd == LC_LOAD_DYLIB || cmd == LC_LOAD_WEAK_DYLIB {
			if uint64(len(data)) >= cmdOffset+24 {
				nameOffset := binary.LittleEndian.Uint32(data[cmdOffset+8 : cmdOffset+12])
				dylibNamePos := cmdOffset + uint64(nameOffset)

				if dylibNamePos < uint64(len(data)) {
					endPos := dylibNamePos
					for endPos < uint64(len(data)) && data[endPos] != 0 {
						endPos++
					}

					existingDylib := string(data[dylibNamePos:endPos])
					if existingDylib == dylibPath {
						// Dylib already exists, check if we need to change type
						desiredCmd := uint32(LC_LOAD_DYLIB)
						if weak {
							desiredCmd = LC_LOAD_WEAK_DYLIB
						}

						if cmd != desiredCmd {
							// Change type
							binary.LittleEndian.PutUint32(data[cmdOffset:cmdOffset+4], desiredCmd)
						}
						return data, nil
					}
				}
			}
		}

		cmdOffset += uint64(cmdsize)
	}

	// Dylib doesn't exist, add new command
	dylibFileLength := uint32(len(dylibPath))
	dylibFilePadding := (8 - dylibFileLength%8) % 8
	dylibCommandSize := 24 + dylibFileLength + dylibFilePadding

	// Calculate free space in load commands area
	freeSpace := uint32(0)
	if csOffset, _, err := FindCodeSignatureOffset(data, headerOffset); err == nil && csOffset > 0 {
		loadCmdsEnd := headerOffset + headerSize + uint64(sizeofcmds)
		csOffsetU64 := uint64(csOffset)
		if csOffsetU64 > loadCmdsEnd {
			freeSpace = uint32(csOffsetU64 - loadCmdsEnd)
		}
	}

	if freeSpace > 0 && freeSpace < dylibCommandSize {
		return nil, fmt.Errorf("not enough free space in load commands for dylib injection")
	}

	// Add dylib command at the end of existing load commands
	newCmdPos := headerOffset + headerSize + uint64(sizeofcmds)

	result := make([]byte, len(data))
	copy(result, data)

	// Build dylib_command structure
	cmdType := uint32(LC_LOAD_DYLIB)
	if weak {
		cmdType = LC_LOAD_WEAK_DYLIB
	}

	// Write dylib_command
	binary.LittleEndian.PutUint32(result[newCmdPos:newCmdPos+4], cmdType)
	binary.LittleEndian.PutUint32(result[newCmdPos+4:newCmdPos+8], dylibCommandSize)
	binary.LittleEndian.PutUint32(result[newCmdPos+8:newCmdPos+12], 24) // name.offset
	binary.LittleEndian.PutUint32(result[newCmdPos+12:newCmdPos+16], 2) // timestamp
	binary.LittleEndian.PutUint32(result[newCmdPos+16:newCmdPos+20], 0) // current_version
	binary.LittleEndian.PutUint32(result[newCmdPos+20:newCmdPos+24], 0) // compatibility_version

	// Write dylib path with padding
	dylibWithPadding := make([]byte, dylibFileLength+dylibFilePadding)
	copy(dylibWithPadding, []byte(dylibPath))
	copy(result[newCmdPos+24:], dylibWithPadding)

	// Update header
	binary.LittleEndian.PutUint32(result[headerOffset+16:headerOffset+20], ncmds+1)
	binary.LittleEndian.PutUint32(result[headerOffset+20:headerOffset+24], sizeofcmds+dylibCommandSize)

	return result, nil
}
