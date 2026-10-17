package intercept

import (
	"context"
	"errors"
	"testing"
)

func TestPermanentReviewError(t *testing.T) {
	permanent := []string{
		"openai: status 400: bad request",
		"anthropic: status 401: unauthorized",
		"status 403 forbidden",
		"status 404: model not found",
		"status 422 unprocessable",
		"invalid_api_key",
		"insufficient_quota",
	}
	for _, msg := range permanent {
		if !permanentReviewError(errors.New(msg)) {
			t.Fatalf("%q should be permanent", msg)
		}
	}
	retryable := []string{
		"openai: status 429: rate limit exceeded",
		"status 408 request timeout",
		"context deadline exceeded",
		"dial tcp: connection reset by peer",
		"dial tcp: network is unreachable",
		"anthropic: overloaded_error",
		"模型输出无法解析",
	}
	for _, msg := range retryable {
		if permanentReviewError(errors.New(msg)) {
			t.Fatalf("%q should remain retryable", msg)
		}
	}
	if permanentReviewError(nil) {
		t.Fatal("nil error must not be permanent")
	}
}

// TestJudgeRetryStopsOnPermanentError ensures a bad credential/bad request does
// not burn the whole retry budget.
func TestJudgeRetryStopsOnPermanentError(t *testing.T) {
	calls := 0
	cfg := JudgeConfig{RetryCount: 3, RetryIntervalMS: 1}
	_, err := reviewWithRetry(context.Background(), cfg, func(context.Context, int64, string, ReviewInput) (Decision, error) {
		calls++
		return Decision{}, errors.New("openai: status 401: unauthorized")
	}, ReviewInput{})
	if err == nil {
		t.Fatal("want an error")
	}
	if calls != 1 {
		t.Fatalf("reviewer called %d times, want 1 (permanent error must not retry)", calls)
	}
}
