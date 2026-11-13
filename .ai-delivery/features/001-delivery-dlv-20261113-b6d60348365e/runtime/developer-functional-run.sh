#!/usr/bin/env bash
set -euo pipefail

: "${AIDELIVERY_DELIVERY_ID:?AIDELIVERY_DELIVERY_ID is required}"
: "${AIDELIVERY_CANDIDATE_SHA:?AIDELIVERY_CANDIDATE_SHA is required}"
: "${DEV_FUNCTIONAL_BASE_URL:?DEV_FUNCTIONAL_BASE_URL is required}"
: "${DEV_FUNCTIONAL_RESULT_PATH:?DEV_FUNCTIONAL_RESULT_PATH is required}"

mkdir -p "$(dirname "$DEV_FUNCTIONAL_RESULT_PATH")"

write_result() {
  local passed="$1"
  jq -n \
    --argjson passed "$passed" \
    --arg deliveryId "$AIDELIVERY_DELIVERY_ID" \
    --arg candidateSha "$AIDELIVERY_CANDIDATE_SHA" \
    '{
      passed: $passed,
      scenarios: [
        {
          id: "IQA-001",
          passed: $passed,
          externalServices: ["Azure AI Speech", "Azure AI Foundry"],
          evidence: "Playwright controlled artifact: IQA-001"
        },
        {
          id: "IQA-002",
          passed: $passed,
          externalServices: ["Azure AI Speech", "Azure AI Foundry"],
          evidence: "Playwright controlled artifact: IQA-002"
        },
        {
          id: "IQA-003",
          passed: $passed,
          externalServices: ["Azure AI Speech", "Azure AI Foundry"],
          evidence: "Playwright controlled artifact: IQA-003"
        }
      ],
      evidence: [
        ("deliveryId=" + $deliveryId),
        ("candidateSha=" + $candidateSha),
        "Playwright HTML report and retained controlled artifacts"
      ]
    }' >"$DEV_FUNCTIONAL_RESULT_PATH"
}

if DEV_FUNCTIONAL_BASE_URL="$DEV_FUNCTIONAL_BASE_URL" npm run test:functional; then
  write_result true
else
  write_result false
  exit 1
fi
