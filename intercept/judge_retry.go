package intercept

import (
	"context"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"
)

const (
	MaxJudgeRetryCount          = 20
	MaxJudgeRetryIntervalMS     = 3600_000
	defaultJudgeRetryIntervalMS = 1000
)

// ValidateRetry rejects invalid settings before any judge configuration is saved.
func (c JudgeConfig) ValidateRetry() error {
	if c.RetryCount < 0 || c.RetryCount > MaxJudgeRetryCount {
		return fmt.Errorf("retry_count 必须在 0 到 %d 之间", MaxJudgeRetryCount)
	}
	if c.RetryIntervalMS < 0 || c.RetryIntervalMS > MaxJudgeRetryIntervalMS {
		return fmt.Errorf("retry_interval_ms 必须在 0 到 %d 之间", MaxJudgeRetryIntervalMS)
	}
	return nil
}

// permanentReviewError reports failures that cannot change on retry: bad
// credentials, a malformed request, or a model this account may not use.
// Retrying those only burns quota. Rate limits (429) and timeouts stay
// retryable.
func permanentReviewError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	for _, code := range []string{"status 400", "status 401", "status 403", "status 404", "status 422"} {
		if strings.Contains(text, code) {
			return true
		}
	}
	for _, key := range []string{"invalid_api_key", "invalid api key", "unauthorized", "permission denied", "insufficient_quota"} {
		if strings.Contains(text, key) {
			return true
		}
	}
	return false
}

// reviewWithRetry retries failed classifications, including invalid verdicts.
// The captured input stays identical across attempts. A valid deny/ask verdict
// is final, and parent cancellation interrupts both requests and the retry wait.
// Provider-level connection/empty-response retries still run within each attempt.
func reviewWithRetry(ctx context.Context, cfg JudgeConfig, rv Reviewer, input ReviewInput) (out Decision, err error) {
	for attempt := 0; attempt <= cfg.RetryCount; attempt++ {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		if attempt > 0 && cfg.RetryIntervalMS > 0 {
			// Exponential backoff (×1, ×2, ×4, ×8 then flat) with ±20% jitter:
			// a flapping model must not be hammered at a fixed rate. The settings
			// page shows the resulting worst-case wait.
			factor := 1 << min(attempt-1, 3)
			delay := time.Duration(cfg.RetryIntervalMS*factor) * time.Millisecond
			delay += time.Duration(rand.Int64N(int64(delay/5) + 1))
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return out, ctx.Err()
			case <-timer.C:
			}
		}
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		attemptCtx := ctx
		cancel := func() {}
		if cfg.TimeoutSeconds > 0 {
			attemptCtx, cancel = context.WithTimeout(ctx, time.Duration(cfg.TimeoutSeconds)*time.Second)
		}
		out, err = rv(attemptCtx, cfg.ProfileID, cfg.Prompt, input)
		if attemptCtx.Err() != nil {
			err = attemptCtx.Err()
		}
		cancel()
		if err != nil && permanentReviewError(err) {
			return out, err
		}
		if err == nil {
			switch out.Action {
			case "allow", "ask", "deny":
				return out, nil
			default:
				err = fmt.Errorf("模型输出无法解析")
			}
		}
	}
	return out, err
}
