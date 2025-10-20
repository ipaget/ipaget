package logger

import (
	"fmt"
	"io"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var Logger zerolog.Logger

const (
	colorReset  = "\033[0m"
	colorRed    = "\033[31m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorBlue   = "\033[34m"
	colorCyan   = "\033[36m"
	colorGray   = "\033[90m"
	colorWhite  = "\033[97m"

	colorBgRed = "\033[41m"
)

func Init(debug bool, quiet bool) {
	zerolog.TimeFieldFormat = time.RFC3339

	output := zerolog.ConsoleWriter{
		Out:        os.Stdout,
		TimeFormat: "2006/01/02 - 15:04:05",
		NoColor:    false,
		PartsOrder: []string{
			zerolog.LevelFieldName,
			zerolog.TimestampFieldName,
			zerolog.MessageFieldName,
		},
		FormatLevel: func(i interface{}) string {
			var level string
			if ll, ok := i.(string); ok {
				switch ll {
				case "debug":
					level = colorGray + "DBG" + colorReset
				case "info":
					level = colorGreen + "INF" + colorReset
				case "warn":
					level = colorYellow + "WRN" + colorReset
				case "error":
					level = colorRed + "ERR" + colorReset
				case "fatal":
					level = colorBgRed + colorWhite + "FTL" + colorReset
				default:
					level = "???"
				}
			}
			return level
		},
		FormatFieldName: func(i interface{}) string {
			return fmt.Sprintf("%s=", i)
		},
		FormatFieldValue: func(i interface{}) string {
			return fmt.Sprintf("\"%s\"", i)
		},
	}

	var level zerolog.Level
	if quiet {
		level = zerolog.Disabled
	} else if debug {
		level = zerolog.DebugLevel
	} else {
		level = zerolog.InfoLevel
	}

	Logger = zerolog.New(output).Level(level).With().Timestamp().Logger()
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

		// Format status code with color
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

		// Format method with color
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

		// Format latency
		latencyStr := fmt.Sprintf("%.2fms", float64(latency.Microseconds())/1000.0)

		// Log with simplified format: METHOD /path STATUS IP latency
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
				Error().
					Interface("error", err).
					Str("path", c.Request.URL.Path).
					Str("method", c.Request.Method).
					Msg("Panic recovered")
				c.AbortWithStatus(500)
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
