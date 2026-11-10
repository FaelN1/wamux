package logger

import (
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/rs/zerolog"
	"gopkg.in/natefinch/lumberjack.v2"
)

func New(logDir, level string, isDev bool) zerolog.Logger {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lvl)

	generalDir := filepath.Join(logDir, "general")
	_ = os.MkdirAll(generalDir, 0750)

	fileWriter := &lumberjack.Logger{
		Filename:   filepath.Join(generalDir, time.Now().Format("2006-01-02")+".log"),
		MaxSize:    50,
		MaxBackups: 7,
		MaxAge:     7,
		Compress:   true,
	}

	var writers []io.Writer
	writers = append(writers, fileWriter)

	if isDev {
		consoleWriter := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}
		writers = append(writers, consoleWriter)
	} else {
		writers = append(writers, os.Stdout)
	}

	multi := zerolog.MultiLevelWriter(writers...)

	return zerolog.New(multi).With().Timestamp().Caller().Logger()
}

func NewInstanceLogger(logDir, instanceID string, isDev bool) zerolog.Logger {
	instDir := filepath.Join(logDir, "instances", instanceID)
	_ = os.MkdirAll(instDir, 0750)

	fileWriter := &lumberjack.Logger{
		Filename:   filepath.Join(instDir, time.Now().Format("2006-01-02")+".log"),
		MaxSize:    50,
		MaxBackups: 7,
		MaxAge:     7,
		Compress:   true,
	}

	var writers []io.Writer
	writers = append(writers, fileWriter)

	if isDev {
		consoleWriter := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}
		writers = append(writers, consoleWriter)
	} else {
		writers = append(writers, os.Stdout)
	}

	multi := zerolog.MultiLevelWriter(writers...)

	return zerolog.New(multi).With().
		Timestamp().
		Str("instance_id", instanceID).
		Logger()
}
