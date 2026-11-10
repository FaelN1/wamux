package handler

import (
	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"

	"github.com/gofiber/fiber/v2"
)

type OrderHandler struct {
	manager *instance.Manager
}

func NewOrderHandler(manager *instance.Manager) *OrderHandler {
	return &OrderHandler{manager: manager}
}

// GET /api/v1/order/:id?token=...
//
// The token is required by the protocol and comes from the order message the
// customer sent — it is not derivable from the order id alone.
func (h *OrderHandler) Get(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}
	if inst.Status != instance.StatusConnected {
		return invalidRequestResponse(c, "Instance is not connected.")
	}

	orderID := c.Params("id")
	if orderID == "" {
		return invalidRequestResponse(c, "Order id is required.")
	}
	token := c.Query("token")
	if token == "" {
		return invalidRequestResponse(c, "Query param \"token\" is required (comes from the order message).")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	order, err := client.GetOrderDetails(orderID, token)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(order)
}
