package whatsapp

import (
	"encoding/base64"
	"fmt"

	waAdv "go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
)

// PortableCreds é a identidade de "aparelho companheiro" (Multi-Device) em
// formato canônico, compatível com o `PortableCredentials` do gateway (WAMux).
// Permite migrar o device entre engines (Baileys ⇄ whatsmeow) sem reparear.
// Todos os binários são base64.
type PortableCreds struct {
	Version        int        `json:"version"`
	RegistrationID uint32     `json:"registrationId"`
	NoiseKey       B64KeyPair `json:"noiseKey"`
	IdentityKey    B64KeyPair `json:"identityKey"`
	SignedPreKey   struct {
		KeyID     uint32     `json:"keyId"`
		KeyPair   B64KeyPair `json:"keyPair"`
		Signature string     `json:"signature"`
	} `json:"signedPreKey"`
	AdvSecretKey string `json:"advSecretKey"`
	Account      struct {
		Details             string `json:"details"`
		AccountSignatureKey string `json:"accountSignatureKey"`
		AccountSignature    string `json:"accountSignature"`
		DeviceSignature     string `json:"deviceSignature"`
	} `json:"account"`
	Me struct {
		ID   string `json:"id"`
		LID  string `json:"lid,omitempty"`
		Name string `json:"name,omitempty"`
	} `json:"me"`
	Platform string `json:"platform,omitempty"`
}

type B64KeyPair struct {
	Public  string `json:"public"`
	Private string `json:"private"`
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }
func unb64(s string) []byte {
	b, _ := base64.StdEncoding.DecodeString(s)
	return b
}
func to32(b []byte) *[32]byte {
	var a [32]byte
	copy(a[:], b)
	return &a
}
func to64(b []byte) *[64]byte {
	var a [64]byte
	copy(a[:], b)
	return &a
}
func kpOut(k *keys.KeyPair) B64KeyPair {
	return B64KeyPair{Public: b64(k.Pub[:]), Private: b64(k.Priv[:])}
}

// ExportDevice lê o *store.Device e o converte para o formato canônico.
func ExportDevice(d *store.Device) (*PortableCreds, error) {
	if d == nil || d.ID == nil {
		return nil, fmt.Errorf("device não pareado (sem sessão para exportar)")
	}
	c := &PortableCreds{Version: 1, RegistrationID: d.RegistrationID}
	c.NoiseKey = kpOut(d.NoiseKey)
	c.IdentityKey = kpOut(d.IdentityKey)
	c.SignedPreKey.KeyID = d.SignedPreKey.KeyID
	c.SignedPreKey.KeyPair = kpOut(&d.SignedPreKey.KeyPair)
	c.SignedPreKey.Signature = b64(d.SignedPreKey.Signature[:])
	c.AdvSecretKey = b64(d.AdvSecretKey)
	if d.Account != nil {
		c.Account.Details = b64(d.Account.Details)
		c.Account.AccountSignatureKey = b64(d.Account.AccountSignatureKey)
		c.Account.AccountSignature = b64(d.Account.AccountSignature)
		c.Account.DeviceSignature = b64(d.Account.DeviceSignature)
	}
	c.Me.ID = d.ID.String()
	c.Platform = d.Platform
	return c, nil
}

// ApplyCreds injeta as credenciais canônicas num *store.Device (o device passa a
// ser aquele já linkado). Só a IDENTIDADE — as sessões Signal re-sincronizam.
func ApplyCreds(d *store.Device, c *PortableCreds) error {
	jid, err := types.ParseJID(c.Me.ID)
	if err != nil {
		return fmt.Errorf("jid inválido em me.id: %w", err)
	}
	d.RegistrationID = c.RegistrationID
	d.NoiseKey = &keys.KeyPair{Pub: to32(unb64(c.NoiseKey.Public)), Priv: to32(unb64(c.NoiseKey.Private))}
	d.IdentityKey = &keys.KeyPair{Pub: to32(unb64(c.IdentityKey.Public)), Priv: to32(unb64(c.IdentityKey.Private))}
	d.SignedPreKey = &keys.PreKey{
		KeyPair: keys.KeyPair{
			Pub:  to32(unb64(c.SignedPreKey.KeyPair.Public)),
			Priv: to32(unb64(c.SignedPreKey.KeyPair.Private)),
		},
		KeyID:     c.SignedPreKey.KeyID,
		Signature: to64(unb64(c.SignedPreKey.Signature)),
	}
	d.AdvSecretKey = unb64(c.AdvSecretKey)
	d.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             unb64(c.Account.Details),
		AccountSignatureKey: unb64(c.Account.AccountSignatureKey),
		AccountSignature:    unb64(c.Account.AccountSignature),
		DeviceSignature:     unb64(c.Account.DeviceSignature),
	}
	d.ID = &jid
	d.Platform = c.Platform
	return nil
}
