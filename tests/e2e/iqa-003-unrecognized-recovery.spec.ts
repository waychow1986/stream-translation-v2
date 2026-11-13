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

test("IQA-003 does not fake an unrecognized subtitle and recovers", async ({
  page,
}, testInfo) => {
  await installFixtureAudio(page, "unrecognized.wav");
  await page.goto(process.env["DEV_FUNCTIONAL_BASE_URL"]!);
  const identity = await candidateIdentity(page);
  expect(identity.deliveryId).toBe(process.env["AIDELIVERY_DELIVERY_ID"]);
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page.getByTestId("segment-unrecognized")).toBeVisible();
  await expect(page.getByTestId("subtitle-segment")).toHaveCount(0);

  await installFixtureAudio(page, "recognized-language-a.wav");
  await page.reload();
  await page.getByRole("button", { name: "开始" }).click();
  const recovered = page.getByTestId("subtitle-segment").first();
  await expect(recovered).toHaveAttribute("data-final", "true");
  await expect(recovered).not.toBeEmpty();
  await attachControlledEvidence(page, testInfo, {
    scenario: "IQA-003",
    fixtureIds: ["unrecognized", "recognized-language-a"],
    candidateIdentity: identity,
    eventOrder: [
      "segment.unrecognized",
      "segment.detected",
      "subtitle.final",
    ],
  });
});
