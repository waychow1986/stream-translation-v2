import { expect, test } from "@playwright/test";

import {
  attachControlledEvidence,
  candidateIdentity,
  installFixtureAudioSequence,
} from "./support/audio-input.js";

test.skip(
  !process.env["DEV_FUNCTIONAL_BASE_URL"],
  "requires the deployed candidate URL and real Azure integration",
);

test("IQA-003 does not fake an unrecognized subtitle and recovers", async ({
  page,
}, testInfo) => {
  await installFixtureAudioSequence(page, [
    "unrecognized.wav",
    "recognized-language-b.wav",
  ]);
  await page.goto(process.env["DEV_FUNCTIONAL_BASE_URL"]!);
  const identity = await candidateIdentity(page);
  expect(identity.deliveryId).toBe(process.env["AIDELIVERY_DELIVERY_ID"]);
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page.getByTestId("segment-unrecognized")).toBeVisible();
  await expect(page.getByTestId("subtitle-segment")).toHaveCount(0);

  const recovered = page.getByTestId("subtitle-segment").first();
  await expect(recovered).toHaveAttribute("data-source-locale", "fr-FR");
  await expect(recovered).toHaveAttribute("data-final", "true");
  await expect(recovered).toContainText("会议");
  await expect(recovered).toContainText("开始");
  await attachControlledEvidence(page, testInfo, {
    scenario: "IQA-003",
    fixtureIds: ["unrecognized", "recognized-language-b"],
    candidateIdentity: identity,
    eventOrder: [
      "segment.unrecognized",
      "segment.detected",
      "subtitle.final",
    ],
  });
});
