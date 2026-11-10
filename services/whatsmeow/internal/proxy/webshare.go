package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

type WebshareProxy struct {
	ID               string `json:"id"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	ProxyAddress     string `json:"proxy_address"`
	Port             int    `json:"port"`
	Valid            bool   `json:"valid"`
	CountryCode      string `json:"country_code"`
	CityName         string `json:"city_name"`
	LastVerification string `json:"last_verification"`
}

func (p *WebshareProxy) SOCKS5URL() string {
	return fmt.Sprintf("socks5://%s:%s@%s:%d", p.Username, p.Password, p.ProxyAddress, p.Port)
}

func (p *WebshareProxy) HTTPURL() string {
	return fmt.Sprintf("http://%s:%s@%s:%d", p.Username, p.Password, p.ProxyAddress, p.Port)
}

type webshareResponse struct {
	Count    int              `json:"count"`
	Next     *string          `json:"next"`
	Previous *string          `json:"previous"`
	Results  []WebshareProxy  `json:"results"`
}

type Provider struct {
	mu          sync.Mutex
	apiKey      string
	proxies     []WebshareProxy
	assigned    map[string]int // instanceID -> proxy index
	nextIndex   int
	lastRefresh time.Time
	refreshTTL  time.Duration
	log         zerolog.Logger
}

func NewProvider(apiKey string, log zerolog.Logger) *Provider {
	return &Provider{
		apiKey:     apiKey,
		assigned:   make(map[string]int),
		refreshTTL: 5 * time.Minute,
		log:        log,
	}
}

// Enabled returns true if a Webshare API key is configured
func (p *Provider) Enabled() bool {
	return p.apiKey != ""
}

// Assign returns a proxy URL for the given instance.
// If the instance already has an assigned proxy, returns the same one.
// Otherwise assigns the next available proxy (round-robin).
func (p *Provider) Assign(instanceID string) (string, error) {
	if !p.Enabled() {
		return "", nil
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if err := p.refreshIfNeeded(); err != nil {
		return "", err
	}

	if len(p.proxies) == 0 {
		return "", fmt.Errorf("no proxies available from Webshare")
	}

	// Check if already assigned
	if idx, ok := p.assigned[instanceID]; ok {
		if idx < len(p.proxies) && p.proxies[idx].Valid {
			return p.proxies[idx].SOCKS5URL(), nil
		}
		// Proxy no longer valid, reassign
		delete(p.assigned, instanceID)
	}

	// Find next valid proxy
	startIdx := p.nextIndex
	for i := 0; i < len(p.proxies); i++ {
		idx := (startIdx + i) % len(p.proxies)
		if p.proxies[idx].Valid {
			p.assigned[instanceID] = idx
			p.nextIndex = (idx + 1) % len(p.proxies)
			proxy := p.proxies[idx]
			p.log.Info().
				Str("instance_id", instanceID).
				Str("proxy", proxy.ProxyAddress).
				Str("country", proxy.CountryCode).
				Msg("proxy assigned")
			return proxy.SOCKS5URL(), nil
		}
	}

	return "", fmt.Errorf("no valid proxies available")
}

// Release removes the proxy assignment for an instance
func (p *Provider) Release(instanceID string) {
	p.mu.Lock()
	delete(p.assigned, instanceID)
	p.mu.Unlock()
}

// Refresh forces a refresh of the proxy list from Webshare
func (p *Provider) Refresh() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.fetchProxies()
}

func (p *Provider) refreshIfNeeded() error {
	if time.Since(p.lastRefresh) < p.refreshTTL {
		return nil
	}
	return p.fetchProxies()
}

func (p *Provider) fetchProxies() error {
	var allProxies []WebshareProxy
	url := "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=100"

	for url != "" {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Authorization", "Token "+p.apiKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return fmt.Errorf("failed to fetch proxies: %w", err)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return fmt.Errorf("failed to read response: %w", err)
		}

		if resp.StatusCode != 200 {
			return fmt.Errorf("webshare API error: HTTP %d: %s", resp.StatusCode, string(body))
		}

		var data webshareResponse
		if err := json.Unmarshal(body, &data); err != nil {
			return fmt.Errorf("failed to parse response: %w", err)
		}

		allProxies = append(allProxies, data.Results...)

		if data.Next != nil {
			url = *data.Next
		} else {
			url = ""
		}
	}

	valid := 0
	for _, px := range allProxies {
		if px.Valid {
			valid++
		}
	}

	p.proxies = allProxies
	p.lastRefresh = time.Now()
	p.log.Info().
		Int("total", len(allProxies)).
		Int("valid", valid).
		Msg("webshare proxies refreshed")

	return nil
}

// Stats returns proxy usage statistics
func (p *Provider) Stats() map[string]interface{} {
	p.mu.Lock()
	defer p.mu.Unlock()
	valid := 0
	for _, px := range p.proxies {
		if px.Valid {
			valid++
		}
	}
	return map[string]interface{}{
		"total":    len(p.proxies),
		"valid":    valid,
		"assigned": len(p.assigned),
	}
}
