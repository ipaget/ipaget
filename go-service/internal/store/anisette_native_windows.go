package store

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var anisetteWinHTTP = windows.NewLazySystemDLL("winhttp.dll")
var anisetteWinOpen = anisetteWinHTTP.NewProc("WinHttpOpen")
var anisetteWinConnect = anisetteWinHTTP.NewProc("WinHttpConnect")
var anisetteWinOpenRequest = anisetteWinHTTP.NewProc("WinHttpOpenRequest")
var anisetteWinSetTimeouts = anisetteWinHTTP.NewProc("WinHttpSetTimeouts")
var anisetteWinSend = anisetteWinHTTP.NewProc("WinHttpSendRequest")
var anisetteWinReceive = anisetteWinHTTP.NewProc("WinHttpReceiveResponse")
var anisetteWinQueryHeaders = anisetteWinHTTP.NewProc("WinHttpQueryHeaders")
var anisetteWinRead = anisetteWinHTTP.NewProc("WinHttpReadData")
var anisetteWinClose = anisetteWinHTTP.NewProc("WinHttpCloseHandle")

func init() { nativeAnisetteHTTP = windowsAnisetteHTTP }

func windowsAnisetteHTTP(request *http.Request, proxy *url.URL, timeout time.Duration) (*http.Response, error) {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(request.Context(), timeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	failure := func(stage string, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if errors.Is(err, syscall.Errno(12002)) {
			return fmt.Errorf("native Anisette %s timed out: %w", stage, context.DeadlineExceeded)
		}
		if err == nil || err == syscall.Errno(0) {
			err = errors.New("Windows HTTP call failed")
		}
		return fmt.Errorf("native Anisette %s failed: %w", stage, err)
	}
	agent, _ := windows.UTF16PtrFromString("iPAGet")
	accessType := uintptr(1)
	var proxyName *uint16
	if proxy != nil {
		if proxy.Scheme != "http" || proxy.User != nil {
			return nil, fmt.Errorf("unsupported native Anisette proxy")
		}
		accessType = 3
		var err error
		proxyName, err = windows.UTF16PtrFromString(proxy.Host)
		if err != nil {
			return nil, err
		}
	}
	session, _, callErr := anisetteWinOpen.Call(uintptr(unsafe.Pointer(agent)), accessType, uintptr(unsafe.Pointer(proxyName)), 0, 0)
	if session == 0 {
		return nil, failure("session", callErr)
	}
	defer anisetteWinClose.Call(session)
	milliseconds := uintptr(timeout.Milliseconds())
	if result, _, err := anisetteWinSetTimeouts.Call(session, milliseconds, milliseconds, milliseconds, milliseconds); result == 0 {
		return nil, failure("timeouts", err)
	}
	host, err := windows.UTF16PtrFromString(request.URL.Hostname())
	if err != nil {
		return nil, err
	}
	port := 80
	flags := uintptr(0)
	if request.URL.Scheme == "https" {
		port = 443
		flags = 0x00800000
	}
	if request.URL.Port() != "" {
		port, err = strconv.Atoi(request.URL.Port())
		if err != nil {
			return nil, err
		}
	}
	connection, _, callErr := anisetteWinConnect.Call(session, uintptr(unsafe.Pointer(host)), uintptr(port), 0)
	if connection == 0 {
		return nil, failure("connection", callErr)
	}
	defer anisetteWinClose.Call(connection)
	method, err := windows.UTF16PtrFromString(request.Method)
	if err != nil {
		return nil, err
	}
	path, err := windows.UTF16PtrFromString(request.URL.RequestURI())
	if err != nil {
		return nil, err
	}
	handle, _, callErr := anisetteWinOpenRequest.Call(connection, uintptr(unsafe.Pointer(method)), uintptr(unsafe.Pointer(path)), 0, 0, 0, flags)
	if handle == 0 {
		return nil, failure("request", callErr)
	}
	var closeOnce sync.Once
	closeRequest := func() { closeOnce.Do(func() { anisetteWinClose.Call(handle) }) }
	defer closeRequest()
	stop := context.AfterFunc(ctx, closeRequest)
	defer stop()
	var body []byte
	if request.Body != nil {
		defer request.Body.Close()
		body, err = io.ReadAll(io.LimitReader(request.Body, (2<<20)+1))
		if err != nil {
			return nil, err
		}
		if len(body) > 2<<20 {
			return nil, fmt.Errorf("Anisette request exceeds size limit")
		}
	}
	var headerText strings.Builder
	for name, values := range request.Header {
		if strings.EqualFold(name, "Host") || strings.EqualFold(name, "Content-Length") || strings.EqualFold(name, "Transfer-Encoding") {
			continue
		}
		for _, value := range values {
			if strings.ContainsAny(name+value, "\r\n") {
				return nil, fmt.Errorf("invalid Anisette header")
			}
			headerText.WriteString(name + ": " + value + "\r\n")
		}
	}
	headers, err := windows.UTF16PtrFromString(headerText.String())
	if err != nil {
		return nil, err
	}
	var bodyPointer uintptr
	if len(body) > 0 {
		bodyPointer = uintptr(unsafe.Pointer(&body[0]))
	}
	result, _, callErr := anisetteWinSend.Call(handle, uintptr(unsafe.Pointer(headers)), 0xFFFFFFFF, bodyPointer, uintptr(len(body)), uintptr(len(body)), 0)
	runtime.KeepAlive(headers)
	if result == 0 {
		return nil, failure("send", callErr)
	}
	result, _, callErr = anisetteWinReceive.Call(handle, 0)
	runtime.KeepAlive(body)
	if result == 0 {
		return nil, failure("receive", callErr)
	}
	var status uint32
	size := uint32(4)
	result, _, callErr = anisetteWinQueryHeaders.Call(handle, 19|0x20000000, 0, uintptr(unsafe.Pointer(&status)), uintptr(unsafe.Pointer(&size)), 0)
	if result == 0 {
		return nil, failure("status", callErr)
	}
	var data []byte
	buffer := make([]byte, 8192)
	for {
		var count uint32
		result, _, callErr = anisetteWinRead.Call(handle, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), uintptr(unsafe.Pointer(&count)))
		runtime.KeepAlive(buffer)
		if result == 0 {
			return nil, failure("read", callErr)
		}
		if count == 0 {
			break
		}
		data = append(data, buffer[:count]...)
		if len(data) > 1<<20 {
			return nil, fmt.Errorf("Anisette response exceeds size limit")
		}
	}
	return &http.Response{StatusCode: int(status), Status: fmt.Sprintf("%d %s", status, http.StatusText(int(status))), Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data)), ContentLength: int64(len(data)), Request: request, Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1}, nil
}
