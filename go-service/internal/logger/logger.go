package logger

import (
	"fmt"
	"io"
	"ipaget-service/internal/logbuffer"
	"os"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var (
	Logger    zerolog.Logger
	LogBuffer *logbuffer.Buffer
)

const (
	colorRed    = "\033[31m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorCyan   = "\033[36m"
	colorBlue   = "\033[34m"
	colorGray   = "\033[90m"
	colorWhite  = "\033[97m"
	colorBgRed  = "\033[41m"
	colorReset  = "\033[0m"
)

func Init(debug bool, quiet bool) {
	zerolog.TimeFieldFormat = time.RFC3339
	LogBuffer = logbuffer.New(200)

	var writers []io.Writer

	// Always write JSON to the buffer
	writers = append(writers, LogBuffer)

	// Add console writer based on mode
	if !quiet {
		if debug {
			// In debug mode, use pretty console output
			writers = append(writers, zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: "15:04:05"})
		} else {
			// In production, write JSON to stdout as well
			writers = append(writers, os.Stdout)
		}
	}

	multi := zerolog.MultiLevelWriter(writers...)

	var level zerolog.Level
	if quiet {
		level = zerolog.Disabled
	} else if debug {
		level = zerolog.DebugLevel
	} else {
		level = zerolog.InfoLevel
	}

	Logger = zerolog.New(multi).
		Level(level).
		With().
		Timestamp().
		Logger()

	log.Logger = Logger
}

func Debug() *zerolog.Event {
	return Logger.Debug()
}

func Info() *zerolog.Event {
	return Logger.Info()
}

func Warn() *zerolog.Event {
	return Logger.Warn()
}

func Error() *zerolog.Event {
	return Logger.Error()
}

func Fatal() *zerolog.Event {
	return Logger.Fatal()
}

type GinWriter struct{}

func (w GinWriter) Write(p []byte) (n int, err error) {
	Info().Msg(string(p))
	return len(p), nil
}

func GinLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		method := c.Request.Method

		if raw != "" {
			path = path + "?" + raw
		}

		var statusColor string
		statusText := fmt.Sprintf("%d", statusCode)
		switch {
		case statusCode >= 500:
			statusColor = colorBgRed + colorWhite + statusText + colorReset
		case statusCode >= 400:
			statusColor = colorYellow + statusText + colorReset
		case statusCode >= 300:
			statusColor = colorCyan + statusText + colorReset
		case statusCode >= 200:
			statusColor = colorGreen + statusText + colorReset
		default:
			statusColor = colorWhite + statusText + colorReset
		}

		var methodColor string
		switch method {
		case "GET":
			methodColor = colorBlue + method + colorReset
		case "POST":
			methodColor = colorGreen + method + colorReset
		case "PUT":
			methodColor = colorYellow + method + colorReset
		case "DELETE":
			methodColor = colorRed + method + colorReset
		default:
			methodColor = colorCyan + method + colorReset
		}

		latencyStr := fmt.Sprintf("%.2fms", float64(latency.Microseconds())/1000.0)

		message := fmt.Sprintf("%s %s %s %s %s",
			methodColor,
			path,
			statusColor,
			colorGray+clientIP+colorReset,
			colorGray+"latency="+latencyStr+colorReset,
		)

		errorMsg := c.Errors.ByType(gin.ErrorTypePrivate).String()
		if errorMsg != "" {
			Logger.Info().Msgf("%s %s", message, colorRed+"error="+errorMsg+colorReset)
		} else {
			Logger.Info().Msg(message)
		}
	}
}

func GinRecovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				// Get stack trace
				buf := make([]byte, 4096)
				n := runtime.Stack(buf, false)
				stackTrace := string(buf[:n])

				Error().
					Interface("error", err).
					Str("path", c.Request.URL.Path).
					Str("method", c.Request.Method).
					Str("stack", stackTrace).
					Msg("Panic recovered")

				// Return proper JSON error response
				c.JSON(500, gin.H{
					"error": fmt.Sprintf("Internal server error: %v", err),
				})
				c.Abort()
			}
		}()
		c.Next()
	}
}

func SetupGin() {
	gin.DefaultWriter = io.Discard
	gin.DefaultErrorWriter = io.Discard
	gin.DebugPrintRouteFunc = func(httpMethod, absolutePath, handlerName string, nuHandlers int) {
		Debug().
			Str("method", httpMethod).
			Str("path", absolutePath).
			Str("handler", handlerName).
			Int("handlers", nuHandlers).
			Msg("Route registered")
	}
}
