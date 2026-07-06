package database

import (
	"database/sql"
	"database/sql/driver"
	"strings"

	sqlite "modernc.org/sqlite"
)

func init() {
	sql.Register("sqlite3", fkDriver{})
}

// fkDriver wraps modernc sqlite driver to auto-enable foreign keys
type fkDriver struct{}

func (fkDriver) Open(name string) (driver.Conn, error) {
	// Append _pragma=foreign_keys(1) for modernc sqlite
	if !strings.Contains(name, "_pragma") {
		sep := "?"
		if strings.Contains(name, "?") {
			sep = "&"
		}
		name += sep + "_pragma=foreign_keys(1)"
	}

	d := &sqlite.Driver{}
	return d.Open(name)
}
