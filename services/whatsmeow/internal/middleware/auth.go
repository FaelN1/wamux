package middleware

import (
	"wamux_go/internal/instance"

	"github.com/gofiber/fiber/v2"
)

func APIKeyAuth(repo instance.Repository) fiber.Handler {
	return func(c *fiber.Ctx) error {
		apiKey := c.Get("X-API-Key")
		if apiKey == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error":   "unauthorized",
				"message": "API Key is required. Provide it via X-API-Key header.",
				"status":  401,
			})
		}

		inst, err := repo.GetByAPIKey(c.Context(), apiKey)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error":   "unauthorized",
				"message": "Invalid API Key.",
				"status":  401,
			})
		}

		c.Locals("instance", inst)
		return c.Next()
	}
}

func MasterKeyAuth(masterKey string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		apiKey := c.Get("X-API-Key")
		// Fallback to query param for SSE (EventSource doesn't support custom headers)
		if apiKey == "" {
			apiKey = c.Query("api_key")
		}
		if apiKey == "" || apiKey != masterKey {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error":   "unauthorized",
				"message": "Master API Key is required.",
				"status":  401,
			})
		}
		return c.Next()
	}
}

func GetInstance(c *fiber.Ctx) *instance.Instance {
	inst, ok := c.Locals("instance").(*instance.Instance)
	if !ok {
		return nil
	}
	return inst
}
