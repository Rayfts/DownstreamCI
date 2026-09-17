package downstream

import (
    "testing"
    lib "example.com/fixture-go-lib"
)

func TestAPI(t *testing.T) {
    if lib.API() != "stable" { t.Fatal("unexpected API") }
}
