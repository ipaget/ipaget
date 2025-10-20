package sign

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func isFolder(path string) bool {
	fileInfo, err := os.Open(path)
	if err != nil {
		return false
	}
	defer fileInfo.Close()

	fileMode, err := fileInfo.Stat()
	if err != nil {
		return false
	}

	return fileMode.IsDir()
}

func copyFile(src string, dst string) error {
	input, err := os.ReadFile(src)
	if err != nil {
		return err
	}

	err = os.WriteFile(dst, input, 0644)
	if err != nil {
		return err
	}

	return nil
}

func extractZip(src string, dest string) error {
	return extractZipWithProgress(src, dest, nil)
}

func extractZipWithProgress(src string, dest string, progressCallback func(progress float64)) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	os.MkdirAll(dest, 0755)

	totalFiles := len(r.File)

	extractAndWriteFile := func(f *zip.File) error {
		rc, err := f.Open()
		if err != nil {
			return err
		}
		defer rc.Close()

		path := filepath.Join(dest, f.Name)

		if !strings.HasPrefix(path, filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path: %s", path)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(path, 0755)
		} else {
			os.MkdirAll(filepath.Dir(path), 0755)
			outFile, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
			if err != nil {
				return err
			}
			defer outFile.Close()

			_, err = io.Copy(outFile, rc)
			if err != nil {
				return err
			}
		}
		return nil
	}

	for i, f := range r.File {
		err := extractAndWriteFile(f)
		if err != nil {
			return err
		}

		if progressCallback != nil {
			progress := float64(i+1) / float64(totalFiles) * 100
			progressCallback(progress)
		}
	}

	return nil
}

func addFilesToZip(zipWriter *zip.Writer, folderPath string, baseInZip string) error {
	return addFilesToZipWithLevel(zipWriter, folderPath, baseInZip, -1)
}

func addFilesToZipWithLevel(zipWriter *zip.Writer, folderPath string, baseInZip string, compressionLevel int) error {
	files, err := os.ReadDir(folderPath)
	if err != nil {
		return err
	}

	for _, file := range files {
		filePath := filepath.Join(folderPath, file.Name())
		if file.IsDir() {
			err := addFilesToZipWithLevel(zipWriter, filePath, filepath.Join(baseInZip, file.Name()), compressionLevel)
			if err != nil {
				return err
			}
		} else {
			err := addFileToZipWithLevel(zipWriter, filePath, baseInZip, compressionLevel)
			if err != nil {
				return err
			}
		}
	}

	return nil
}

func addFileToZip(zipWriter *zip.Writer, filePath string, baseInZip string) error {
	return addFileToZipWithLevel(zipWriter, filePath, baseInZip, -1)
}

func addFileToZipWithLevel(zipWriter *zip.Writer, filePath string, baseInZip string, compressionLevel int) error {
	fileToZip, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer fileToZip.Close()

	fileInfo, err := fileToZip.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(fileInfo)
	if err != nil {
		return err
	}

	header.Name = filepath.Join(baseInZip, filepath.Base(filePath))

	// Set compression method based on level
	if compressionLevel == 0 {
		header.Method = zip.Store // No compression
	} else {
		header.Method = zip.Deflate // Compression
	}

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, fileToZip)
	return err
}

func createZip(dst string, src string) error {
	return createZipWithLevel(dst, src, 0)
}

func createZipWithLevel(dst string, src string, level int) error {
	zipFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// Set compression level (0-9)
	// 0 = no compression, 9 = best compression
	// Default is -1 (zip.DefaultCompression)
	var compressionLevel int
	if level >= 0 && level <= 9 {
		compressionLevel = level
	} else {
		compressionLevel = -1 // Default
	}

	err = addFilesToZipWithLevel(zipWriter, src, filepath.Base(src), compressionLevel)
	if err != nil {
		return err
	}

	return nil
}

func locateAppFolder(inputFolder string) (string, error) {
	fileInfo, err := os.Stat(inputFolder)
	if err != nil {
		return "", fmt.Errorf("failed to stat the input folder: %s", err)
	}

	if !fileInfo.IsDir() {
		return "", fmt.Errorf("the input folder is not a folder")
	}

	files, err := os.ReadDir(inputFolder)
	if err != nil {
		return "", err
	}

	for _, file := range files {
		if file.IsDir() && strings.HasSuffix(file.Name(), ".app") {
			return filepath.Join(inputFolder, file.Name()), nil
		}
	}

	return "", fmt.Errorf("failed to find the app folder")
}

func uint32ToBytes(val uint32) []byte {
	return []byte{
		byte(val >> 24),
		byte(val >> 16),
		byte(val >> 8),
		byte(val),
	}
}

func uint64ToBytes(val uint64) []byte {
	return []byte{
		byte(val >> 56),
		byte(val >> 48),
		byte(val >> 40),
		byte(val >> 32),
		byte(val >> 24),
		byte(val >> 16),
		byte(val >> 8),
		byte(val),
	}
}

func bytesToUint32(b []byte) uint32 {
	return uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])
}

func bytesToUint64(b []byte) uint64 {
	return uint64(b[0])<<56 | uint64(b[1])<<48 | uint64(b[2])<<40 | uint64(b[3])<<32 |
		uint64(b[4])<<24 | uint64(b[5])<<16 | uint64(b[6])<<8 | uint64(b[7])
}

func padTo(data []byte, alignment int) []byte {
	if len(data)%alignment == 0 {
		return data
	}
	padSize := alignment - (len(data) % alignment)
	padding := make([]byte, padSize)
	return append(data, padding...)
}
