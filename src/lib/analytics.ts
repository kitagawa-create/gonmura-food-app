"use client";

import { getAnalytics, logEvent, isSupported } from "firebase/analytics";
import { getApps } from "firebase/app";

let analyticsInstance: ReturnType<typeof getAnalytics> | null = null;

async function getAnalyticsInstance() {
  if (analyticsInstance) return analyticsInstance;
  if (typeof window === "undefined") return null;
  const supported = await isSupported();
  if (!supported) return null;
  const app = getApps()[0];
  if (!app) return null;
  analyticsInstance = getAnalytics(app);
  return analyticsInstance;
}

export async function trackEvent(
  eventName: string,
  params?: Record<string, string | number>
) {
  const analytics = await getAnalyticsInstance();
  if (analytics) {
    logEvent(analytics, eventName, params);
  }
}
