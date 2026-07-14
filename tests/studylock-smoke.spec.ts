import { test, expect } from '@playwright/test';

test('local onboarding and study session flow', async ({ page }) => {
  // Mock OpenRouter API call
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const request = route.request();
    console.log(`[Playwright Mock] Route matched: ${request.method()} to ${request.url()}`);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    question: 'Was ist ein Aktivkonto?',
                    answer: 'Ein Aktivkonto mehrt sich im Soll und mindert sich im Haben.',
                    topic: 'Rechnungswesen',
                    difficulty: 'leicht',
                    type: 'karte',
                  },
                ]),
              },
            },
          ],
        }),
      });
    }
  });

  page.on('console', (msg) => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });

  // 1. Open home page
  await page.goto('/');

  // 2. Onboarding hero card must be visible on first visit with intact UTF-8 copy
  await expect(page.locator('.hero-card.onboarding')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dein Skript wird ein täglicher Klausurplan.' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('├');
  await expect(page.locator('body')).not.toContainText('Γ');

  // 3. Click onboarding import button
  await page.click('text=Jetzt Material importieren');

  // 4. In MaterialImport view, load demo text
  await expect(page.locator('h2:has-text("PDF, TXT oder Skript einfügen")')).toBeVisible();
  await page.click('text=Demo laden');

  // Verify that Title is filled
  const titleVal = await page.inputValue('label:has-text("Titel") >> input');
  expect(titleVal).toBe('Rechnungswesen Demo');

  // 5. Submit document import (handles both AI and heuristic text dynamically inside the work panel)
  await page.click('.work-panel .hero-actions button:first-child');

  // 6. Should transition to ExamSetup view
  await expect(page.locator('h2:has-text("Wofür muss StudyLock dich verantwortlich halten?")')).toBeVisible();
  // Click "Später" to skip custom exam config
  await page.click('text=Später');

  // 7. Now in MainApp dashboard checkin view
  await expect(page.locator('h2:has-text("Klausurplan einrichten")')).toBeVisible();

  // 8. Start a session (click the play button in the checkin panel)
  await page.click('.work-panel .hero-actions button:first-child');

  // 9. Now in Session view
  await expect(page.locator('.session-screen')).toBeVisible();

  // Answer the question in the textarea
  await page.fill('.answer-box', 'Das ist meine Antwort für den Smoke Test, die lang genug ist.');

  // Open model answer details
  await page.click('summary:has-text("Musterlösung / Quelle ansehen")');

  // Rate the first item as good, then complete every remaining item in a
  // dynamically sized AI/heuristic session before finishing it.
  await page.getByRole('button', { name: 'Sitzt (3)' }).click();

  const nextQuestion = page.getByRole('button', { name: /Nächste Frage/ });
  while (await nextQuestion.isVisible()) {
    await nextQuestion.click();
    await page.fill('.answer-box', 'Das ist eine weitere ausreichend lange Antwort für den Smoke Test.');
    await page.getByRole('button', { name: 'Sitzt (3)' }).click();
  }

  // 10. Finish session
  await page.getByRole('button', { name: /Session abschließen/ }).click();

  // 11. Now in SessionDone view
  await expect(page.locator('text=4 / Auswertung')).toBeVisible();
});
