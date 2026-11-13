import { expect, test } from "@playwright/test";

import {
  attachControlledEvidence,
  candidateIdentity,
  installFixtureAudio,
} from "./support/audio-input.js";

test.skip(
  !process.env["DEV_FUNCTIONAL_BASE_URL"],
  "requires the deployed candidate URL and real Azure integration",
);

test("IQA-001 streams Chinese subtitles without language selection", async ({
  page,
}, testInfo) => {
  await installFixtureAudio(page, "recognized-language-a.wav");
  await page.goto(process.env["DEV_FUNCTIONAL_BASE_URL"]!);
  const identity = await candidateIdentity(page);
  expect(identity.deliveryId).toBe(process.env["AIDELIVERY_DELIVERY_ID"]);
  expect(identity.candidateSha).toBe(process.env["AIDELIVERY_CANDIDATE_SHA"]);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.getByRole("button", { name: "开始" }).click();
  const subtitle = page.getByTestId("subtitle-segment").first();
  await expect(subtitle).toBeVisible();
  const initial = await subtitle.textContent();
  await expect
    .poll(async () => subtitle.textContent())
    .not.toBe(initial);
  await expect(subtitle).toHaveAttribute("data-final", "true");
  await expect(subtitle).toContainText("会议");
  await expect(subtitle).toContainText("开始");
  await attachControlledEvidence(page, testInfo, {
    scenario: "IQA-001",
    fixtureIds: ["recognized-language-a"],
    candidateIdentity: identity,
    eventOrder: ["session.ready", "subtitle.delta", "subtitle.final"],
  });
});
