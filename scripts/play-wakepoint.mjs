#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => errors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("button", { name: /^launch$/i }).click({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/workspace/screenshots/playing.png" });

  const probe = await page.evaluate(() => {
    const t = window.__controlsTest;
    return t ? { x: t.getX(), y: t.getY(), speed: t.getSpeed() } : null;
  });
  if (!probe) throw new Error("missing __controlsTest");

  await page.evaluate(() => window.__controlsTest.setKeys(["KeyA"]));
  await page.waitForTimeout(450);
  const afterA = await page.evaluate(() => {
    const t = window.__controlsTest;
    return { x: t.getX(), y: t.getY(), speed: t.getSpeed() };
  });
  await page.evaluate(() => window.__controlsTest.setKeys([]));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__controlsTest.setKeys(["KeyD"]));
  await page.waitForTimeout(450);
  const afterD = await page.evaluate(() => {
    const t = window.__controlsTest;
    return { x: t.getX(), y: t.getY(), speed: t.getSpeed() };
  });
  await page.evaluate(() => window.__controlsTest.setKeys([]));

  const aLeft = afterA.x < probe.x - 8;
  const dRight = afterD.x > afterA.x + 8;

  await page.keyboard.press("KeyP");
  await page.waitForTimeout(450);
  let pauseVisible = await page
    .getByRole("heading", { name: /paused/i })
    .isVisible()
    .catch(() => false);
  if (!pauseVisible) {
    await page.getByRole("button", { name: /pause/i }).click();
    await page.waitForTimeout(300);
    pauseVisible = await page.getByRole("heading", { name: /paused/i }).isVisible();
  }
  await page.screenshot({ path: "/workspace/screenshots/paused.png" });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  mobile.on("pageerror", (err) => errors.push("mobile " + String(err.message || err)));
  await mobile.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 45000 });
  await mobile.waitForTimeout(400);
  const overflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  await mobile.screenshot({ path: "/workspace/screenshots/mobile-title.png" });
  await mobile.getByRole("button", { name: /^launch$/i }).click({ timeout: 15000 });
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: "/workspace/screenshots/mobile-play.png" });
  await mobile.close();

  console.log(
    JSON.stringify(
      { probe, afterA, afterD, aLeft, dRight, pauseVisible, overflow, errors },
      null,
      2,
    ),
  );

  if (errors.length) process.exit(2);
  if (!aLeft || !dRight) process.exit(3);
  if (!pauseVisible) process.exit(4);
  if (overflow) process.exit(5);
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
}
