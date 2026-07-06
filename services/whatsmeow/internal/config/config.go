package config

import (
	"fmt"
	"os"
)

type Config struct {
	AppPort             string
	AppEnv              string
	AppVersion          string
	DatabaseURL         string
	WhatsmeowSessionDir string
	MasterAPIKey        string
	SentryDSN           string
	WebshareAPIKey      string
	LogDir              string
	LogLevel            string
}

func Load() (*Config, error) {
	cfg := &Config{
		AppPort:             getEnv("APP_PORT", "3000"),
		AppEnv:              getEnv("APP_ENV", "production"),
		AppVersion:          getEnv("APP_VERSION", "v1.0.0"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		WhatsmeowSessionDir: getEnv("WHATSMEOW_SESSION_DIR", "./sessions"),
		MasterAPIKey:        os.Getenv("MASTER_API_KEY"),
		SentryDSN:           os.Getenv("SENTRY_DSN"),
		WebshareAPIKey:      os.Getenv("WEBSHARE_API_KEY"),
		LogDir:              getEnv("LOG_DIR", "./logs"),
		LogLevel:            getEnv("LOG_LEVEL", "info"),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.MasterAPIKey == "" {
		return nil, fmt.Errorf("MASTER_API_KEY is required")
	}

	return cfg, nil
}

func (c *Config) IsDevelopment() bool {
	return c.AppEnv == "development"
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
