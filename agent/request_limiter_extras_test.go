package agent

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestRequestLimiterJitterSpreadsWaits checks the opt-in jitter stays inside its
// documented envelope: never shorter than the window, never longer than +20%
// (capped at 250ms). It deliberately asserts bounds, not exact values.
func TestRequestLimiterJitterSpreadsWaits(t *testing.T) {
	l := &RequestLimiter{}
	if err := l.configure(1, 0); err != nil {
		t.Fatalf("configure: %v", err)
	}
	l.EnableJitter()

	base := time.Second
	// The first attempt is granted immediately; jitter applies to the waits that
	// follow, so prime the limiter before measuring.
	if err := l.wait(context.Background()); err != nil {
		t.Fatalf("prime: %v", err)
	}
	for i := 0; i < 3; i++ {
		start := time.Now()
		if err := l.wait(context.Background()); err != nil {
			t.Fatalf("wait %d: %v", i, err)
		}
		elapsed := time.Since(start)
		if elapsed < base-50*time.Millisecond {
			t.Fatalf("wait %d took %s, want at least %s", i, elapsed, base)
		}
		if elapsed > base+300*time.Millisecond {
			t.Fatalf("wait %d took %s, want at most %s", i, elapsed, base+300*time.Millisecond)
		}
	}
}

type countingTransport struct {
	inFlight    atomic.Int32
	maxInFlight atomic.Int32
	release     chan struct{}
}

func (c *countingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	cur := c.inFlight.Add(1)
	for {
		prev := c.maxInFlight.Load()
		if cur <= prev || c.maxInFlight.CompareAndSwap(prev, cur) {
			break
		}
	}
	<-c.release
	c.inFlight.Add(-1)
	return &http.Response{StatusCode: 200, Body: http.NoBody, Request: req}, nil
}

// TestRequestLimiterConcurrencyGateCapsInFlight proves EnableConcurrency keeps
// at most ceil(rate) (min 4, max 32) requests on the wire at once.
func TestRequestLimiterConcurrencyGateCapsInFlight(t *testing.T) {
	l := &RequestLimiter{}
	if err := l.configure(4, 0); err != nil {
		t.Fatalf("configure: %v", err)
	}
	l.EnableConcurrency()

	base := &countingTransport{release: make(chan struct{})}
	client := &http.Client{Transport: rateLimitedTransport{base: base, limiter: l}}

	const total = 24
	var wg sync.WaitGroup
	wg.Add(total)
	for i := 0; i < total; i++ {
		go func() {
			defer wg.Done()
			req, err := http.NewRequest(http.MethodGet, "http://example.test/", nil)
			if err != nil {
				t.Errorf("new request: %v", err)
				return
			}
			res, err := client.Do(req)
			if err != nil {
				t.Errorf("do: %v", err)
				return
			}
			_ = res.Body.Close()
		}()
	}

	// Let the goroutines queue on the gate, then release them one batch at a time.
	time.Sleep(150 * time.Millisecond)
	if got := base.inFlight.Load(); got > 4 {
		t.Fatalf("in flight before release = %d, want <= 4", got)
	}
	for i := 0; i < 8; i++ {
		time.Sleep(60 * time.Millisecond)
		base.release <- struct{}{}
	}
	close(base.release)
	wg.Wait()

	if got := base.maxInFlight.Load(); got > 4 {
		t.Fatalf("max in flight = %d, want <= 4", got)
	}
	if got := base.maxInFlight.Load(); got < 2 {
		t.Fatalf("max in flight = %d, want >= 2 (gate must allow real parallelism)", got)
	}
}
